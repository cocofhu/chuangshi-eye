import { WebSocket, WebSocketServer } from 'ws';
import { realtimeInstructions } from '../openai/instructions.js';
import { GEV_REALTIME_TOOLS } from '../openai/tools.js';

export const DASHSCOPE_REALTIME_URL =
  'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
export const DASHSCOPE_REALTIME_MODEL_DEFAULT = 'qwen3.5-omni-flash-realtime';
export const DASHSCOPE_REALTIME_VOICE_DEFAULT = 'Cherry';
const RELAY_PATH = '/api/dashscope/realtime';
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_SESSIONS = 4;

/** Client events the relay forwards; everything else is dropped. */
const CLIENT_EVENTS = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
]);

const CHINESE_GUIDANCE =
  '默认使用简体中文与用户交流；用户用其他语言提问时用相同语言回答。地名、机构名使用中文常用名称。';

export function dashscopeKey(env = process.env) {
  return String(env.DASHSCOPE_API_KEY || '').trim();
}

export function dashscopeModel(env = process.env) {
  return (
    String(env.DASHSCOPE_REALTIME_MODEL || '').trim() ||
    DASHSCOPE_REALTIME_MODEL_DEFAULT
  );
}

/** OpenAI Realtime tools are flat; Qwen-Omni nests them under `function`. */
export function toDashscopeTools(tools) {
  return tools
    .filter((tool) => tool?.type === 'function' && tool.name)
    .map(({ name, description, parameters }) => ({
      type: 'function',
      function: { name, description, parameters },
    }));
}

export function dashscopeSessionUpdate({
  env = process.env,
  annotationGuidance,
  tools = GEV_REALTIME_TOOLS,
} = {}) {
  const transcribeModel =
    String(env.DASHSCOPE_REALTIME_TRANSCRIBE_MODEL || '').trim() ||
    'gummy-realtime-v1';
  return {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      voice:
        String(env.DASHSCOPE_REALTIME_VOICE || '').trim() ||
        DASHSCOPE_REALTIME_VOICE_DEFAULT,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      instructions: `${realtimeInstructions(annotationGuidance)}\n\n${CHINESE_GUIDANCE}`,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        silence_duration_ms: 800,
      },
      ...(transcribeModel.toLowerCase() === 'off'
        ? {}
        : { input_audio_transcription: { model: transcribeModel } }),
      tools: toDashscopeTools(tools),
    },
  };
}

/**
 * Narrow one browser event to what Qwen-Omni accepts. `response.create`
 * keeps only per-response instructions; OpenAI-only fields are dropped.
 */
export function sanitizeClientEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!event || !CLIENT_EVENTS.has(event.type)) return null;
  if (event.type === 'response.create') {
    const instructions = event.response?.instructions;
    return typeof instructions === 'string' && instructions
      ? { type: 'response.create', response: { instructions } }
      : { type: 'response.create' };
  }
  return event;
}

function sameOrigin(req) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Bailian (百炼) Qwen-Omni realtime voice. The browser opens a same-origin
 * WebSocket to /api/dashscope/realtime; the relay attaches the API key,
 * configures the session (instructions and tools are server-owned) and
 * forwards OpenAI-Realtime-shaped events in both directions.
 */
export function dashscopeRealtimeProxy({
  env = process.env,
  annotationGuidance,
  tools = GEV_REALTIME_TOOLS,
  connectUpstream = (url, headers) => new WebSocket(url, { headers }),
} = {}) {
  let sessions = 0;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });

  function relay(client) {
    const key = dashscopeKey(env);
    const url = `${String(env.DASHSCOPE_REALTIME_URL || '').trim() || DASHSCOPE_REALTIME_URL}?model=${encodeURIComponent(dashscopeModel(env))}`;
    const upstream = connectUpstream(url, { Authorization: `Bearer ${key}` });
    const pending = [];
    let closed = false;
    sessions++;
    const close = (code = 1000, reason = '') => {
      if (closed) return;
      closed = true;
      sessions--;
      try {
        client.close(code, reason);
      } catch {
        /* already closed */
      }
      try {
        upstream.close();
      } catch {
        /* already closed */
      }
    };
    upstream.on('open', () => {
      upstream.send(
        JSON.stringify(
          dashscopeSessionUpdate({ env, annotationGuidance, tools }),
        ),
      );
      for (const frame of pending.splice(0)) upstream.send(frame);
    });
    upstream.on('message', (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data.toString());
    });
    upstream.on('error', (error) => {
      console.warn('[dashscope] upstream error:', error?.message || error);
      close(1011, 'upstream error');
    });
    upstream.on('close', () => close(1000, 'upstream closed'));
    client.on('message', (data) => {
      const event = sanitizeClientEvent(data.toString());
      if (!event) return;
      const frame = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else if (pending.length < 64) pending.push(frame);
    });
    client.on('close', () => close());
    client.on('error', () => close());
  }

  function onUpgrade(req, socket, head) {
    if (String(req.url || '').split('?')[0] !== RELAY_PATH) return;
    const refuse = (status) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!sameOrigin(req)) return refuse('403 Forbidden');
    if (!dashscopeKey(env)) return refuse('503 Service Unavailable');
    if (sessions >= MAX_SESSIONS) return refuse('429 Too Many Requests');
    wss.handleUpgrade(req, socket, head, relay);
  }

  function status(req, res) {
    res.writeHead(req.method === 'GET' ? 200 : 405, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        configured: Boolean(dashscopeKey(env)),
        model: dashscopeModel(env),
      }),
    );
  }

  function install(server) {
    server.middlewares.use('/api/dashscope/status', status);
    server.httpServer?.on('upgrade', onUpgrade);
    server.httpServer?.once('close', () => wss.close());
  }

  return {
    name: 'dashscope-realtime',
    configureServer: install,
    configurePreviewServer: install,
  };
}
