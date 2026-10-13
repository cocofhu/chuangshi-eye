import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import {
  dashscopeRealtimeProxy,
  dashscopeSessionUpdate,
  sanitizeClientEvent,
  toDashscopeTools,
} from '../../server/providers/china/dashscope.js';
import {
  createDefaultVoiceBackend,
  floatToPcm16Base64,
  pcm16Base64ToFloat,
} from '../voice/dashscopeBackend.js';

const TOOL = {
  type: 'function',
  name: 'fly_to_location',
  description: 'Fly the camera',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
};

test('flat Realtime tools are nested for Qwen-Omni', () => {
  assert.deepEqual(toDashscopeTools([TOOL]), [
    {
      type: 'function',
      function: {
        name: 'fly_to_location',
        description: 'Fly the camera',
        parameters: TOOL.parameters,
      },
    },
  ]);
  const { session } = dashscopeSessionUpdate({ env: {}, tools: [TOOL] });
  assert.equal(session.input_audio_format, 'pcm');
  assert.equal(session.turn_detection.type, 'server_vad');
  assert.match(session.instructions, /简体中文/);
  assert.equal(
    dashscopeSessionUpdate({
      env: { DASHSCOPE_REALTIME_TRANSCRIBE_MODEL: 'off' },
    }).session.input_audio_transcription,
    undefined,
  );
});

test('only conversation events pass the relay, minus OpenAI-only fields', () => {
  assert.equal(
    sanitizeClientEvent('{"type":"session.update","session":{}}'),
    null,
  );
  assert.equal(sanitizeClientEvent('not json'), null);
  assert.deepEqual(
    sanitizeClientEvent(
      JSON.stringify({
        type: 'response.create',
        response: { instructions: '简短回答', output_modalities: ['audio'] },
      }),
    ),
    { type: 'response.create', response: { instructions: '简短回答' } },
  );
  assert.deepEqual(
    sanitizeClientEvent(
      '{"type":"response.create","response":{"tool_choice":"none"}}',
    ),
    {
      type: 'response.create',
    },
  );
});

test('PCM16 base64 round-trips', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const back = pcm16Base64ToFloat(floatToPcm16Base64(samples));
  for (let i = 0; i < samples.length; i++)
    assert.ok(Math.abs(back[i] - samples[i]) < 1e-3);
});

test('the default backend stays OpenAI unless Bailian is selected', () => {
  assert.equal(
    createDefaultVoiceBackend(undefined).protocol,
    'openai-realtime',
  );
  assert.equal(
    createDefaultVoiceBackend('dashscope').protocol,
    'dashscope-realtime',
  );
});

test('the relay attaches the key, configures the session and forwards events', async (t) => {
  const upstream = new WebSocketServer({ port: 0 });
  t.after(() => upstream.close());
  await once(upstream, 'listening');
  const received = [];
  let authorization = null;
  upstream.on('connection', (socket, req) => {
    authorization = req.headers.authorization;
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString());
      received.push(event);
      if (event.type === 'input_audio_buffer.append')
        socket.send(
          JSON.stringify({
            type: 'response.audio_transcript.done',
            transcript: '好的',
          }),
        );
    });
  });

  const server = http.createServer();
  t.after(() => server.close());
  const env = {
    DASHSCOPE_API_KEY: 'sk-test',
    DASHSCOPE_REALTIME_URL: `ws://127.0.0.1:${upstream.address().port}`,
  };
  const routes = new Map();
  dashscopeRealtimeProxy({ env, tools: [TOOL] }).configureServer({
    httpServer: server,
    middlewares: { use: (path, fn) => routes.set(path, fn) },
  });
  assert.ok(routes.has('/api/dashscope/status'));
  server.listen(0);
  await once(server, 'listening');
  const port = server.address().port;

  const crossSite = new WebSocket(
    `ws://127.0.0.1:${port}/api/dashscope/realtime`,
    {
      headers: { Origin: 'https://evil.example' },
    },
  );
  const [, response] = await once(crossSite, 'unexpected-response');
  assert.equal(response.statusCode, 403);

  const client = new WebSocket(
    `ws://127.0.0.1:${port}/api/dashscope/realtime`,
    {
      headers: { Origin: `http://127.0.0.1:${port}` },
    },
  );
  await once(client, 'open');
  client.send(
    JSON.stringify({
      type: 'session.update',
      session: { instructions: 'override' },
    }),
  );
  client.send(
    JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' }),
  );
  const [message] = await once(client, 'message');
  assert.deepEqual(JSON.parse(message.toString()), {
    type: 'response.audio_transcript.done',
    transcript: '好的',
  });
  client.close();

  assert.equal(authorization, 'Bearer sk-test');
  assert.equal(received[0].type, 'session.update');
  assert.equal(received[0].session.tools[0].function.name, 'fly_to_location');
  assert.notEqual(received[0].session.instructions, 'override');
  assert.deepEqual(
    received.slice(1).map((e) => e.type),
    ['input_audio_buffer.append'],
  );
});
