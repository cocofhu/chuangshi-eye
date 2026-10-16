import test from 'node:test';
import assert from 'node:assert/strict';

import {
  internetRadioAudioActive,
  localSdrCardView,
  localSdrFeedLine,
  localSdrFmAudioActive,
} from './localSdrPresentation.js';

const idle = Object.freeze({
  webUsbSupported: true,
  connected: false,
  status: 'idle',
  message: '连接 RTL-SDR 以开始。',
  mode: 'fm',
  frequencyHz: 98_500_000,
  volume: 0.8,
  gain: 'auto',
  seeking: false,
  seekMessage: '',
  decodedMessages: 0,
  messagesPerSecond: null,
  aircraftHeard: 0,
  aircraftPositioned: 0,
  deviceLabel: null,
  locationStatus: 'unknown',
  audioState: 'idle',
  samplesPerSecond: 0,
  workerBlocks: 0,
  iqLevelDbfs: null,
  audioLevelDbfs: null,
});

test('an idle card invites a connection and hides receiver stats', () => {
  const view = localSdrCardView(idle);
  assert.equal(view.statusText, '连接 RTL-SDR 以开始。');
  assert.equal(view.connectLabel, '连接');
  assert.equal(view.connectDisabled, false);
  assert.equal(view.connectionLabel, '空闲');
  assert.equal(view.gainValue, '自动');
  assert.equal(view.statsHidden, true);
  assert.equal(view.tuneDisabled, true);
  assert.equal(view.seekDisabled, true);
  assert.equal(view.frequencyValue, '98.5');
  const unsupported = localSdrCardView({
    ...idle,
    webUsbSupported: false,
    status: 'unsupported',
    message: '此浏览器不支持 WebUSB',
  });
  assert.equal(unsupported.connectDisabled, true);
  assert.equal(unsupported.changeDeviceDisabled, true);
  assert.equal(unsupported.statusError, true);
});

test('streaming ADS-B shows message rate, heard, positioned and IQ level', () => {
  const view = localSdrCardView({
    ...idle,
    connected: true,
    status: 'streaming',
    mode: 'adsb',
    message: '正在接收 1090 MHz ADS-B',
    gain: 20.7,
    messagesPerSecond: 13.8,
    aircraftHeard: 4,
    aircraftPositioned: 2,
    iqLevelDbfs: -21.44,
    samplesPerSecond: 2_000_000,
    decodedMessages: 276,
    deviceLabel: 'FlyCatcher_ADS_B',
  });
  assert.equal(view.statsHidden, false);
  assert.deepEqual(view.stats, {
    rate: '13.8',
    heard: '4',
    positioned: '2',
    iq: '-21.4 dBFS',
  });
  assert.equal(view.gainValue, '20.7');
  assert.equal(view.connectionLabel, '已听 4');
  assert.equal(view.connectLabel, '断开');
  assert.equal(view.frequencyDisabled, true);
  assert.equal(view.volumeDisabled, true);
  assert.equal(
    view.statusText,
    '正在接收 1090 MHz ADS-B · FlyCatcher_ADS_B · 2.00 MS/s IQ · 276 条报文',
  );
});

test('local FM and internet radio audio states drive the one-listener rule', () => {
  assert.equal(localSdrFmAudioActive(idle), false);
  assert.equal(
    localSdrFmAudioActive({ ...idle, connected: true, status: 'streaming' }),
    true,
  );
  assert.equal(
    localSdrFmAudioActive({
      ...idle,
      connected: true,
      status: 'streaming',
      mode: 'adsb',
    }),
    false,
    'ADS-B produces no audio',
  );
  for (const audioState of ['loading', 'buffering', 'playing'])
    assert.equal(internetRadioAudioActive({ audioState }), true);
  assert.equal(internetRadioAudioActive({ audioState: 'paused' }), false);
  assert.equal(internetRadioAudioActive(null), false);
});

test('the decoder-feed line appears only when feeds are configured', () => {
  assert.equal(localSdrFeedLine(null), null);
  assert.equal(
    localSdrFeedLine({ configured: false, feeds: [], polling: false }),
    null,
  );
  const feeds = [
    { band: '1090', label: '1090 MHz', status: 'live' },
    { band: '978', label: '978 MHz UAT', status: 'unreachable' },
  ];
  assert.equal(
    localSdrFeedLine({ configured: true, polling: true, feeds }),
    '解码馈源：1090 在线 · 978 不可达',
  );
  assert.equal(
    localSdrFeedLine({ configured: true, polling: false, feeds }),
    '解码馈源：1090 · 978 · 开启本地 ADS-B 时读取',
  );
  assert.equal(
    localSdrFeedLine({
      configured: true,
      polling: false,
      feeds: [{ band: null, label: 'entry 2', status: 'invalid' }],
    }),
    '解码馈源：entry 2 无效 · 开启本地 ADS-B 时读取',
  );
});

test('two feeds on one band are told apart by their ordinal labels', () => {
  const feeds = [
    { band: '1090', label: '1090 MHz', status: 'live' },
    { band: '978', label: '978 MHz UAT #1', status: 'live' },
    { band: '978', label: '978 MHz UAT #2', status: 'stale' },
  ];
  assert.equal(
    localSdrFeedLine({ configured: true, polling: true, feeds }),
    '解码馈源：1090 在线 · 978 MHz UAT #1 在线 · 978 MHz UAT #2 陈旧',
  );
  assert.equal(
    localSdrFeedLine({ configured: true, polling: false, feeds }),
    '解码馈源：1090 · 978 MHz UAT #1 · 978 MHz UAT #2 · 开启本地 ADS-B 时读取',
  );
});
