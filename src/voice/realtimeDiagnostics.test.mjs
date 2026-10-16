import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatErrorForDisplay } from './realtimeDiagnostics.js';

test('the voice error tray maps connection diagnostics and hides browser English', () => {
  const painted = formatErrorForDisplay({
    source: '实时连接',
    message: 'Failed to execute setRemoteDescription on RTCPeerConnection',
    errorDetail: 'dtls-failure',
    code: 'rate_limit_exceeded',
    sctpCauseCode: 12,
    connectionState: 'failed',
    iceConnectionState: 'disconnected',
    dataChannelState: 'closed',
  });
  assert.equal(
    painted,
    '实时连接\n详情：DTLS 失败 · 代码：请求过于频繁 · SCTP：12 · 连接：失败 · ICE：已中断 · 数据通道：已关闭',
  );
  assert.doesNotMatch(painted, /detail=|code=|pc=|ice=|Failed to execute/);
});

test('a Chinese browser fallback stays, and an unknown token is not pasted', () => {
  const painted = formatErrorForDisplay({
    source: 'ICE 候选',
    message: '浏览器未提供错误说明',
    errorDetail: 'stun lookup failed',
    code: 'conversation_already_has_active_response',
    connectionState: 'checking',
  });
  assert.equal(
    painted,
    'ICE 候选：浏览器未提供错误说明\n详情：未识别 · 代码：已有进行中的回复 · 连接：检查中',
  );
  assert.doesNotMatch(painted, /stun lookup/);
});

test('an empty record still has a Chinese tray line', () => {
  assert.equal(formatErrorForDisplay({}), '语音不可用');
});
