import { localReceiverFeedName } from '../layers/localAdsb/feedNames.js';

/**
 * Pure presentation of the Local RTL-SDR card in the Radio panel. Receives the
 * receiver session snapshot and returns what each control should show.
 */

function formatGain(gain) {
  return gain === 'auto' || !Number.isFinite(gain) ? '自动' : gain.toFixed(1);
}

function formatIq(state) {
  return Number.isFinite(state.iqLevelDbfs)
    ? `${state.iqLevelDbfs.toFixed(1)} dBFS`
    : '--';
}

const STATUS_LABELS = {
  idle: '空闲',
  connecting: '连接中',
  tuning: '调谐中',
  streaming: '接收中',
  error: '出错',
  unsupported: '不支持',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '空闲');
}

function statusText(state) {
  const fmActive = state.mode === 'fm';
  const iqStatus =
    state.samplesPerSecond > 0
      ? `${(state.samplesPerSecond / 1_000_000).toFixed(2)} MS/s IQ`
      : '等待 IQ';
  const device = state.deviceLabel ? ` · ${state.deviceLabel}` : '';
  if (state.connected && !fmActive) {
    return `${state.message}${device} · ${iqStatus} · ${state.decodedMessages} 条报文`;
  }
  const detail = state.seeking
    ? state.seekMessage
    : state.seekMessage || state.message;
  if (state.connected && fmActive) {
    const workerStatus =
      state.workerBlocks > 0
        ? `DSP ${state.workerBlocks} 块`
        : 'DSP 等待中';
    const rfStatus = `射频 ${formatIq(state)}`;
    const audioSignal = Number.isFinite(state.audioLevelDbfs)
      ? `音频 ${state.audioLevelDbfs.toFixed(1)} dBFS`
      : '音频信号 --';
    return `${detail}${device} · ${iqStatus} · ${workerStatus} · ${rfStatus} · ${audioSignal} · 音频 ${statusLabel(state.audioState)}`;
  }
  return detail;
}

/**
 * Derive the card's control states from one receiver snapshot.
 * @param {object} state SdrController.getState() snapshot.
 * @returns {object} Control presentation.
 */
export function localSdrCardView(state) {
  const transitional =
    state.status === 'connecting' || state.status === 'tuning';
  const fmActive = state.mode === 'fm';
  const adsbActive = state.mode === 'adsb';
  const fmInteractive =
    state.connected && fmActive && state.status === 'streaming';
  return {
    connectionLabel: state.connected
      ? adsbActive
        ? `已听 ${state.aircraftHeard || 0}`
        : '接收中'
      : statusLabel(state.status || 'idle'),
    connectionActive: Boolean(state.connected),
    connectLabel: transitional
      ? statusLabel(state.status)
      : state.connected
        ? '断开'
        : '连接',
    connectDisabled: transitional || !state.webUsbSupported,
    connectPressed: Boolean(state.connected),
    fmActive,
    adsbActive,
    modeDisabled: transitional,
    locateLabel:
      state.locationStatus === 'requesting'
        ? '定位中…'
        : state.locationStatus === 'ready'
          ? '已定位'
          : '定位',
    locateDisabled: state.locationStatus === 'requesting',
    locateActive: state.locationStatus === 'ready',
    changeDeviceDisabled: transitional || !state.webUsbSupported,
    gainValue: formatGain(state.gain),
    gainDisabled: transitional,
    statsHidden: !(adsbActive && state.connected),
    stats: {
      rate: Number.isFinite(state.messagesPerSecond)
        ? state.messagesPerSecond.toFixed(1)
        : '--',
      heard: String(state.aircraftHeard || 0),
      positioned: String(state.aircraftPositioned || 0),
      iq: formatIq(state),
    },
    frequencyDisabled: !fmActive || transitional,
    frequencyValue: fmActive
      ? (state.frequencyHz / 1_000_000).toFixed(1)
      : null,
    tuneDisabled: !state.connected || !fmActive || transitional,
    seekDisabled: !fmInteractive || Boolean(state.seeking),
    volumePercent: Math.round((Number(state.volume) || 0) * 100),
    volumeDisabled: !fmActive,
    statusText: statusText(state),
    statusError: state.status === 'error' || state.status === 'unsupported',
  };
}

/**
 * Whether the receiver is producing FM audio (the state that must not overlap
 * internet-radio playback).
 * @param {object} state SdrController.getState() snapshot.
 * @returns {boolean}
 */
export function localSdrFmAudioActive(state) {
  return Boolean(
    state?.connected && state.mode === 'fm' && state.status === 'streaming',
  );
}

/**
 * Whether internet radio is loading or playing a station.
 * @param {object} state Radio UI state.
 * @returns {boolean}
 */
export function internetRadioAudioActive(state) {
  return ['loading', 'buffering', 'playing'].includes(state?.audioState);
}

/**
 * One-line decoder-feed summary for the card, or null when the server has no
 * feed configured. Statuses show while Local ADS-B polls the feeds; otherwise
 * the line names the configured bands.
 * @param {object|null} feedState Local receiver feed session snapshot.
 * @returns {string|null}
 */
export function localSdrFeedLine(feedState) {
  const feeds = feedState?.configured === true ? feedState.feeds : null;
  if (!Array.isArray(feeds) || !feeds.length) return null;
  const feedStatusLabel = {
    live: '在线',
    unreachable: '不可达',
    invalid: '无效',
    stale: '陈旧',
  };
  const names = feeds.map((feed) => {
    const name = localReceiverFeedName(feed, feeds);
    const status = feedStatusLabel[feed?.status] || feed?.status || '不可达';
    return feedState.polling || feed?.status === 'invalid'
      ? `${name} ${status}`
      : name;
  });
  const suffix = feedState.polling ? '' : ' · 开启本地 ADS-B 时读取';
  return `解码馈源：${names.join(' · ')}${suffix}`;
}
