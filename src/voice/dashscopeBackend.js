import { createRealtimeBackend } from './realtimeBackend.js';

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
const CHUNK_SAMPLES = 1600;

export function floatToPcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function pcm16Base64ToFloat(base64) {
  const binary = atob(base64);
  const out = new Float32Array(binary.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    const value = (hi << 8) | lo;
    out[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return out;
}

class RelayChannel extends EventTarget {
  constructor(peer) {
    super();
    this.peer = peer;
    this.label = 'dashscope-relay';
    this.readyState = 'connecting';
  }
  send(text) {
    if (this.readyState !== 'open')
      throw new Error('Relay channel is not open');
    this.peer.socket.send(text);
  }
  close() {
    this.peer.close();
  }
}

/**
 * The subset of RTCPeerConnection that RealtimeConnection drives, backed by
 * the same-origin WebSocket relay. Microphone audio is resampled to 16 kHz
 * PCM; 24 kHz PCM deltas are scheduled into a MediaStream that the existing
 * audio element and visualiser consume.
 */
export class DashScopePeer {
  constructor({ url, createSocket = (u) => new WebSocket(u) }) {
    this.url = url;
    this.createSocket = createSocket;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicecandidateerror = null;
    this.stream = null;
    this.channel = null;
    this.socket = null;
    this.input = null;
    this.output = null;
    this.playHead = 0;
    this.sources = new Set();
  }

  addTrack(_track, stream) {
    this.stream = stream;
  }

  createDataChannel() {
    this.channel = new RelayChannel(this);
    return this.channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'dashscope-relay' };
  }

  async setLocalDescription() {}

  async setRemoteDescription() {
    this.socket = this.createSocket(this.url);
    this.socket.addEventListener('open', () => this.opened());
    this.socket.addEventListener('message', (event) =>
      this.received(event.data),
    );
    this.socket.addEventListener('error', () => {
      this.channel?.dispatchEvent(new Event('error'));
    });
    this.socket.addEventListener('close', () => this.closed());
  }

  setState(state) {
    this.connectionState = state;
    this.iceConnectionState = state;
    this.onconnectionstatechange?.();
  }

  opened() {
    this.startCapture();
    this.startPlayback();
    this.setState('connected');
    this.channel.readyState = 'open';
    this.channel.dispatchEvent(new Event('open'));
  }

  received(data) {
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === 'response.audio.delta') {
      if (typeof event.delta === 'string') this.play(event.delta);
      return;
    }
    if (event.type === 'input_audio_buffer.speech_started') this.flush();
    this.channel?.dispatchEvent(new MessageEvent('message', { data }));
  }

  startCapture() {
    if (!this.stream) return;
    const context = new AudioContext({ sampleRate: INPUT_RATE });
    const source = context.createMediaStreamSource(this.stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    let pending = [];
    let pendingLength = 0;
    processor.onaudioprocess = (event) => {
      const track = this.stream?.getAudioTracks()[0];
      if (!track?.enabled || this.socket?.readyState !== WebSocket.OPEN) return;
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      pending.push(samples);
      pendingLength += samples.length;
      if (pendingLength < CHUNK_SAMPLES) return;
      const chunk = new Float32Array(pendingLength);
      let offset = 0;
      for (const part of pending) {
        chunk.set(part, offset);
        offset += part.length;
      }
      pending = [];
      pendingLength = 0;
      this.socket.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: floatToPcm16Base64(chunk),
        }),
      );
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.input = { context, source, processor };
  }

  startPlayback() {
    const context = new AudioContext({ sampleRate: OUTPUT_RATE });
    const destination = context.createMediaStreamDestination();
    this.output = { context, destination };
    this.ontrack?.({ streams: [destination.stream] });
  }

  play(base64) {
    if (!this.output) return;
    const { context, destination } = this.output;
    const samples = pcm16Base64ToFloat(base64);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(destination);
    const startAt = Math.max(context.currentTime + 0.02, this.playHead);
    node.start(startAt);
    this.playHead = startAt + buffer.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  flush() {
    for (const node of this.sources) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.playHead = 0;
  }

  closed() {
    if (this.channel && this.channel.readyState !== 'closed') {
      this.channel.readyState = 'closed';
      this.channel.dispatchEvent(new Event('close'));
    }
    this.release();
    if (this.connectionState !== 'closed') this.setState('closed');
  }

  release() {
    this.flush();
    if (this.input) {
      this.input.processor.onaudioprocess = null;
      this.input.source.disconnect();
      this.input.processor.disconnect();
      void this.input.context.close().catch(() => {});
      this.input = null;
    }
    if (this.output) {
      void this.output.context.close().catch(() => {});
      this.output = null;
    }
  }

  close() {
    if (this.channel) this.channel.readyState = 'closed';
    this.connectionState = 'closed';
    this.release();
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
  }
}

/** Bailian (百炼) Qwen-Omni voice through the server relay. */
export function createDashScopeBackend({
  statusEndpoint = '/api/dashscope/status',
  relayPath = '/api/dashscope/realtime',
  transport = (...args) => fetch(...args),
  location = globalThis.location,
} = {}) {
  return Object.freeze({
    protocol: 'dashscope-realtime',
    async requestToken({ signal } = {}) {
      const response = await transport(statusEndpoint, {
        signal,
        cache: 'no-store',
        redirect: 'error',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.configured)
        throw new Error(
          '百炼语音未配置：请在「接入数据」中填写 DASHSCOPE_API_KEY',
        );
      return {
        token: 'relay',
        model: typeof data.model === 'string' ? data.model : null,
        tier: null,
        transcribeModel: 'off',
        expiresAt: null,
      };
    },
    async negotiate() {
      return 'dashscope-relay';
    },
    createPeer() {
      const scheme = location?.protocol === 'https:' ? 'wss:' : 'ws:';
      return new DashScopePeer({
        url: `${scheme}//${location?.host}${relayPath}`,
      });
    },
  });
}

/** `VOICE_PROVIDER=dashscope` selects Bailian; anything else keeps OpenAI. */
export function createDefaultVoiceBackend(
  provider = import.meta.env?.VOICE_PROVIDER,
) {
  return provider === 'dashscope'
    ? createDashScopeBackend()
    : createRealtimeBackend();
}
