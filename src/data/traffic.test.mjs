// src/data/traffic.test.mjs
// Feed-state honesty for the traffic layer (roadmap L7).
//
// A launch-day stranger runs a keyless build. The layer then simulates
// traffic, and every surface it drives — the toggle chip, the panel meta
// line, the traffic sync chip — has to say so. The two pure helpers below own
// that contract; the layer's getStats() is a thin caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import trafficLayer, {
  deriveTrafficFlowError,
  trafficFeedPresentation,
} from './traffic.js';
import { DataLayerManager, layerFeedState } from './manager.js';

/**
 * The app's live markers. Case-SENSITIVE on purpose: uppercase LIVE/GPS is
 * how this UI asserts a real feed ("LIVE · TomTom flow", the old "initiating
 * global GPS sync"), while lowercase "add TomTom key for live" names the
 * remedy without claiming one.
 */
const LIVE_CLAIM = /\bLIVE\b|\bGPS\b|\breal[- ]?time\b/;

test('a superseded flow fetch is not an outage', () => {
  assert.equal(deriveTrafficFlowError({ name: 'AbortError', message: 'aborted' }), null);
  assert.equal(deriveTrafficFlowError(null), null);
  assert.equal(deriveTrafficFlowError(undefined), null);
});

test('flow failures map onto short, specific reasons', () => {
  const reason = (message) => deriveTrafficFlowError(new Error(message));
  assert.equal(reason('flow tile 12/1/1: HTTP 503'), 'TomTom 密钥不可用');
  assert.equal(reason('flow tile 12/1/1: HTTP 429'), 'TomTom 日额度已用尽');
  assert.equal(reason('flow tile 12/1/1: HTTP 502'), 'TomTom 上游不可达');
  assert.equal(reason('flow tile 12/1/1: HTTP 504'), 'TomTom 上游不可达');
  assert.equal(reason('flow tile 12/1/1: HTTP 418'), 'TomTom 路况错误（HTTP 418）');
  assert.equal(reason('flow fetch failed'), 'TomTom 路况不可用');
});

test('keyless traffic names the mode and the remedy, loading or idle', () => {
  const idle = trafficFeedPresentation({ liveMode: false, fetching: false });
  const loading = trafficFeedPresentation({ liveMode: false, fetching: true });
  assert.equal(idle.mode, 'sim');
  assert.equal(loading.mode, 'sim');
  // Keyless is a designed fallback, not a fault — no error, or every keyless
  // build would boot with a red chip.
  assert.equal(idle.error, null);
  assert.equal(loading.error, null);
  // One terse line in both states; the chip's progress text carries "working".
  assert.equal(idle.loadingLabel, '模拟 — 添加 TomTom 密钥以获取实时路况');
  assert.equal(loading.loadingLabel, '模拟 — 添加 TomTom 密钥以获取实时路况');
});

test('no keyless label ever implies a live feed', () => {
  const labels = [
    trafficFeedPresentation({ liveMode: false, fetching: false }),
    trafficFeedPresentation({ liveMode: false, fetching: true }),
    trafficFeedPresentation({ statusUnavailable: true }),
    trafficFeedPresentation({ liveMode: true, flowError: 'TomTom 路况不可用' }),
    trafficFeedPresentation({ liveMode: true, fetching: true, flowError: 'TomTom 路况不可用' }),
  ].map((feed) => feed.loadingLabel);
  for (const label of labels) {
    assert.ok(!LIVE_CLAIM.test(label), `label implies live data: ${label}`);
    assert.ok(!label.startsWith('实时'), `label implies live data: ${label}`);
    assert.ok(label.startsWith('模拟'), `fallback label must lead with the mode: ${label}`);
  }
});

test('simulating because the status probe failed reads differently from keyless by design', () => {
  const probeDown = trafficFeedPresentation({ statusUnavailable: true });
  assert.equal(probeDown.mode, 'sim');
  assert.equal(probeDown.loadingLabel, '模拟 — 路况服务不可达');
});

test('a healthy keyed layer reports live flow with its real coverage', () => {
  const idle = trafficFeedPresentation({ liveMode: true, coveragePct: 87 });
  assert.deepEqual(idle, {
    mode: 'live',
    error: null,
    loadingLabel: '实时 · 道路：OpenStreetMap · 路况：TomTom · 87% 覆盖 · 未匹配：模拟',
  });
  assert.equal(
    trafficFeedPresentation({ liveMode: true, fetching: true }).loadingLabel,
    '正在同步路况 · 道路：OpenStreetMap · 路况：TomTom · 未匹配：模拟',
  );
});

test('a mid-session flow outage degrades instead of reporting stale live coverage', () => {
  const down = trafficFeedPresentation({
    liveMode: true,
    flowError: 'TomTom 日额度已用尽',
    coveragePct: 87, // last-good number — must not be presented as current
  });
  // error and loadingLabel are ONE string: the manager's error branch renders
  // `error` and drops `loadingLabel`, so the copy has to live in both.
  assert.equal(down.error, '模拟 — TomTom 日额度已用尽');
  assert.equal(down.loadingLabel, down.error);
  assert.ok(!down.loadingLabel.includes('87'));
  const busy = trafficFeedPresentation({
    liveMode: true,
    fetching: true,
    flowError: 'TomTom 日额度已用尽',
  });
  assert.deepEqual(busy, down, 'the degraded state reads the same whether or not a load is in flight');
});

test('the rendered steady-state meta line carries the SIMULATED copy', () => {
  const mgr = new DataLayerManager({});
  const stats = (feed) => ({ count: 544, lastUpdate: Date.now(), ...feed });
  assert.equal(
    mgr._buildMetaText({
      source: 'OpenStreetMap',
      stats: stats(trafficFeedPresentation({ liveMode: false })),
    }),
    '回退 · OpenStreetMap · 模拟 — 添加 TomTom 密钥以获取实时路况',
  );
  assert.equal(
    mgr._buildMetaText({
      source: 'OpenStreetMap',
      stats: stats(trafficFeedPresentation({
        liveMode: true,
        flowError: 'TomTom 日额度已用尽',
      })),
    }),
    '降级 · OpenStreetMap · 模拟 — TomTom 日额度已用尽',
  );
});

test('the manager reads keyless as FALLBACK and an outage as DEGRADED', () => {
  const settled = { count: 4200, lastUpdate: Date.now() };
  assert.equal(
    layerFeedState({ ...settled, ...trafficFeedPresentation({ liveMode: false }) }),
    'fallback',
  );
  assert.equal(
    layerFeedState({ ...settled, ...trafficFeedPresentation({ liveMode: true }) }),
    'nominal',
  );
  assert.equal(
    layerFeedState({
      ...settled,
      ...trafficFeedPresentation({ liveMode: true, flowError: 'TomTom 路况不可用' }),
    }),
    'degraded',
  );
});

test('the shipped layer boots keyless-honest before any status check', () => {
  const stats = trafficLayer.getStats();
  assert.equal(stats.mode, 'sim');
  assert.equal(stats.error, null);
  assert.ok(!LIVE_CLAIM.test(stats.loadingLabel), `boot label implies live data: ${stats.loadingLabel}`);
  assert.equal(layerFeedState(stats), 'fallback');
});

test('traffic can be destroyed before its first enable and destroyed repeatedly', async () => {
  const { default: traffic } = await import('./traffic.js');
  const viewer = { camera: { changed: { removeEventListener() {} } } };
  assert.doesNotThrow(() => traffic.destroy(viewer));
  assert.doesNotThrow(() => traffic.destroy(viewer));
  assert.equal(traffic.getStats().count, 0);
});

test('zero matched dots never claims live coverage', () => {
  const feed = trafficFeedPresentation({ liveMode: true, coveragePct: 0 });
  assert.equal(feed.mode, 'live');
  assert.match(feed.loadingLabel, /^模拟/);
  assert.match(feed.loadingLabel, /TomTom（无匹配）/);
  assert.ok(!LIVE_CLAIM.test(feed.loadingLabel));
});
