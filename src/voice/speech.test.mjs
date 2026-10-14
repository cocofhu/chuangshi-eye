import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPEECH_BUILDERS,
  attachVoiceResult,
  planStepLabel,
  progressLine,
  progressStepLabel,
  spokenLabel,
} from './speech.js';
import { countWords, findHedges } from './speechLint.js';

function envelope(name, result, args) {
  return attachVoiceResult(name, result, args);
}

function assertSpeakable(say) {
  assert.ok(countWords(say) <= 25, `too long: ${say}`);
  assert.deepEqual(findHedges(say), [], `hedged: ${say}`);
}

test('layer toggles confirm the resulting state and fold only material feed tags', () => {
  const on = envelope(
    'set_layer_visibility',
    {
      ok: true,
      action: 'set_layer_visibility',
      layerId: 'flights',
      label: 'Flights',
      enabled: true,
      feedState: 'stale',
    },
    { layerId: 'flights', enabled: true },
  );
  assert.equal(on.say, 'Flights已开启，陈旧.');
  const fallback = envelope(
    'set_layer_visibility',
    {
      ok: true,
      label: 'Flights',
      enabled: true,
      feedState: 'fallback',
      source: 'adsb.lol',
    },
    { enabled: true },
  );
  assert.equal(
    fallback.say,
    'Flights已开启.',
    'a healthy fallback feed is valid data, shown not spoken',
  );
  assert.deepEqual(fallback.display.sources, [{ label: 'adsb.lol' }]);
  const unavailable = envelope(
    'set_layer_visibility',
    {
      ok: true,
      label: 'Active Fires',
      enabled: true,
      feedState: 'unavailable',
    },
    { enabled: true },
  );
  assert.equal(
    unavailable.say,
    'Active Fires已开启，但其数据源不可用。',
  );
  const off = envelope(
    'set_layer_visibility',
    { ok: true, label: 'Flights', enabled: false },
    { enabled: false },
  );
  assert.equal(off.say, 'Flights已关闭.');
  const failed = envelope(
    'set_layer_visibility',
    {
      ok: false,
      layerId: 'traffic',
      error: 'Could not enable the requested layer',
    },
    { layerId: 'traffic', enabled: true },
  );
  assert.equal(failed.say, "无法开启 traffic。");
  assert.equal(failed.ok, false, 'the envelope never changes the outcome');
});

test('aircraft identity always covers operator, type and route from returned fields only', () => {
  const full = envelope('get_entity_context', {
    ok: true,
    selected: {
      id: 'a1b2c3',
      layerId: 'flights',
      name: 'UAL428',
      source: 'OpenSky',
      properties: {
        callsign: 'UAL428',
        operator: 'United Airlines',
        type: 'B738',
        routeOrigin: 'KIAH',
        routeDestination: 'KSFO',
        registration: 'N12345',
      },
    },
  });
  assert.equal(
    full.identityLine,
    'UAL428, United Airlines, B738, KIAH to KSFO.',
  );
  assert.equal(
    full.say,
    null,
    'the identity line is not forced onto other questions',
  );
  assert.ok(
    full.display.lines.includes('注册号 N12345'),
    'registration is shown, not spoken',
  );
  assert.deepEqual(full.referents, [
    { n: 1, id: 'a1b2c3', label: 'UAL428', layerId: 'flights' },
  ]);

  const sparse = envelope('get_entity_context', {
    ok: true,
    selected: {
      id: 'ae01',
      layerId: 'military',
      name: 'RCH123',
      properties: { callsign: 'RCH123' },
    },
  });
  assert.equal(
    sparse.identityLine,
    'RCH123, 运营方未知, 机型未知, 无航路记录.',
  );
  assertSpeakable(sparse.identityLine);

  const routeString = envelope('get_entity_context', {
    ok: true,
    selected: {
      id: 'x',
      layerId: 'flights',
      properties: {
        callsign: 'DAL1',
        operator: 'Delta',
        type: 'A321',
        route: 'KATL-KLAX',
      },
    },
  });
  assert.equal(
    routeString.identityLine,
    'DAL1, Delta, A321, KATL to KLAX.',
    'endpoint codes stay verbatim',
  );

  const place = envelope('get_entity_context', {
    ok: true,
    selected: {
      id: 'dc',
      layerId: 'local-datacenters',
      name: 'Austin DC-7',
      properties: {},
    },
  });
  assert.equal(
    place.say,
    null,
    'non-aircraft answers are composed by the model',
  );
  assert.equal(place.display.title, 'Austin DC-7');
  const inView = { ok: true, scope: 'in_view', visible: [] };
  assert.equal(
    envelope('get_entity_context', inView),
    inView,
    'no selection leaves the result unchanged',
  );
});

test('nearest-aircraft results name the aircraft, distance and altitude briefly', () => {
  const ok = envelope('select_nearest_aircraft', {
    ok: true,
    action: 'select_nearest_aircraft',
    location: 'Austin',
    layerId: 'flights',
    label: 'SWA1940',
    feed: { state: 'nominal', source: 'OpenSky', count: 212 },
    aircraft: {
      id: 'a0b1',
      callsign: 'SWA1940',
      altitudeM: 9449,
      distanceKm: 12.4,
    },
  });
  assert.equal(ok.say, '已选中 SWA1940, 距 Austin 12 km, 31,000 英尺.');
  assertSpeakable(ok.say);
  assert.equal(ok.referents[0].id, 'a0b1');

  const empty = envelope('select_nearest_aircraft', {
    ok: false,
    stage: 'nearest',
    layerId: 'flights',
    location: { label: 'Austin' },
    feed: { state: 'nominal' },
  });
  assert.equal(empty.say, 'Austin附近尚未加载空中航空器。');
  const down = envelope('select_nearest_aircraft', {
    ok: false,
    stage: 'nearest',
    feed: { state: 'unavailable', source: 'OpenSky' },
  });
  assert.equal(down.say, '航空器数据源不可用。');
  const stale = envelope('select_nearest_aircraft', {
    ok: true,
    location: 'Austin',
    feed: { state: 'stale' },
    aircraft: { callsign: 'AAL1', distanceKm: 3.26 },
  });
  assert.equal(stale.say, '已选中 AAL1, 距 Austin 3.3 km, 陈旧.');
});

test('frame_overhead keeps the essential scope audible and lists referents', () => {
  const framed = envelope('frame_overhead', {
    ok: true,
    layerId: 'flights',
    radiusKm: 150,
    count: 14,
    detectionEnabled: true,
    nearest: [
      { id: 'a', label: 'UAL1' },
      { id: 'b', label: null },
      { id: null, label: null },
    ],
  });
  assert.equal(framed.say, '已框选 14 个航空器，范围 150 km.');
  assert.deepEqual(
    framed.referents.map((r) => r.label),
    ['UAL1', 'b'],
  );
  const capped = envelope('frame_overhead', {
    ok: true,
    layerId: 'ais-live-vessels',
    radiusKm: 120,
    count: 80,
    nearest: [],
  });
  assert.equal(capped.say, '已框选 至少 80 个船舶，范围 120 km.');
  const off = envelope('frame_overhead', {
    ok: false,
    layerId: 'satellites',
    error: 'The satellites layer is not enabled',
  });
  assert.equal(off.say, '卫星图层已关闭。要打开吗？');
  const empty = envelope('frame_overhead', {
    ok: false,
    layerId: 'flights',
    radiusKm: 150,
    count: 0,
    error: 'No flights within 150 km of the current view',
  });
  assert.equal(empty.say, '150 km内没有航空器。');
  // The runner's real refusal envelope never claims the sky is empty.
  const refused = envelope('frame_overhead', {
    ok: false,
    action: 'frame_overhead',
    error: 'Camera navigation is unavailable in the current view',
  });
  assert.equal(refused.say, "现在无法框选该目标。");
  const noPolicy = envelope('frame_overhead', {
    ok: false,
    action: 'frame_overhead',
    error: 'Camera navigation policy unavailable',
  });
  assert.doesNotMatch(noPolicy.say, /^No /);
  const cancelled = { ok: false, cancelled: true, action: 'frame_overhead' };
  assert.equal(envelope('frame_overhead', cancelled), cancelled);
});

test('fly_to confirms the destination; cancellation stays silent', () => {
  assert.equal(
    envelope('fly_to_location', { ok: true, label: 'Tokyo' }).say,
    'Flying to Tokyo.',
  );
  assert.equal(
    envelope('fly_to_location', { ok: true, label: 'Austin', arrived: true })
      .say,
    'Over Austin.',
  );
  assert.equal(
    envelope('fly_to_location', { ok: false, cancelled: true, label: 'Austin' })
      .say,
    undefined,
    'a cancelled call keeps its exact outcome',
  );
  assert.equal(
    envelope('fly_to_location', { ok: false, query: 'Atlantis' }).say,
    "Couldn't find Atlantis.",
  );
});

test('view state speaks enabled layers only and is a silent lookup by default', () => {
  const view = envelope('get_current_view_state', {
    ok: true,
    camera: { heightM: 40210 },
    style: 'thermal',
    layers: [
      {
        id: 'flights',
        name: 'Flights',
        enabled: true,
        count: 120,
        feedState: 'stale',
      },
      {
        id: 'local-firms',
        name: 'Fires',
        enabled: true,
        count: 8,
        feedState: 'nominal',
      },
    ],
  });
  assert.equal(
    view.say,
    '相机 40 公里高度. Thermal 风格. Flights和Fires已开启. Flights 陈旧.',
  );
  assert.equal(view.schedule, 'silent');
  assertSpeakable(view.say);
});

test('annotation speech names only what failed and never announces drawing', () => {
  const clean = envelope('annotate_map', {
    ok: true,
    drawn: 2,
    failed: 0,
    items: [
      { ok: true, id: 'anno-1', label: 'Capitol' },
      { ok: true, id: 'anno-2', target: 'Zilker Park' },
    ],
  });
  assert.equal(clean.say, null);
  assert.equal(clean.display.title, '已标记 2 处');
  assert.deepEqual(
    clean.referents.map((r) => r.label),
    ['Capitol', 'Zilker Park'],
  );
  const partial = envelope('annotate_map', {
    ok: true,
    partial: true,
    failedLabels: ['Flibbergibbet Building'],
    items: [{ ok: true, label: 'Capitol' }, { ok: false }],
  });
  assert.equal(partial.say, "无法放置 Flibbergibbet Building。");
  const route = envelope('annotate_map', {
    ok: true,
    routeFallback: true,
    items: [{ ok: true, label: 'A → B' }],
  });
  assert.equal(
    route.say,
    '该线为直线距离，不是街道路线。',
  );
  const pending = envelope('annotate_map', {
    ok: true,
    outlinePending: true,
    items: [{ ok: true, label: 'Presidio' }],
  });
  assert.equal(pending.say, null);
  assert.deepEqual(pending.display.notes, ['正在描边轮廓']);
});

test('analyst speech preserves exact counts, lower bounds and partial status', () => {
  const raw = {
    ok: true,
    action: 'analyst_query',
    count: 3,
    complete: true,
    scopeLabel: 'anywhere in the loaded data',
    coverage: { layersQueried: [{ layerKey: 'flights' }] },
  };
  assert.equal(
    attachVoiceResult('analyst_query', raw).say,
    '3 aircraft anywhere in the loaded data.',
  );
  assert.equal(
    attachVoiceResult('analyst_query', {
      ...raw,
      count: 250_000,
      complete: false,
      partial: true,
      unanswered: ['military'],
    }).say,
    'At least 250,000 aircraft anywhere in the loaded data. 部分；military未回答。',
  );
});

test('builders never break an action and callers can override analyst speech', () => {
  assert.equal(typeof SPEECH_BUILDERS.analyst_query, 'function');
  const raw = { ok: true, action: 'analyst_query', count: 3 };
  const hooked = attachVoiceResult(
    'analyst_query',
    raw,
    {},
    { analyst_query: (r) => ({ say: `${r.count} found.` }) },
  );
  assert.equal(hooked.say, '3 found.');
  const throwing = attachVoiceResult(
    'x',
    raw,
    {},
    {
      x: () => {
        throw new Error('boom');
      },
    },
  );
  assert.equal(throwing, raw);
  assert.equal(attachVoiceResult('set_layer_visibility', null), null);
});

test('labels are bounded and cleaned before they are spoken', () => {
  assert.equal(
    spokenLabel('  Texas\u0000 State\n Capitol '),
    'Texas State Capitol',
  );
  assert.equal(spokenLabel('x'.repeat(80)).length, 48);
  assert.equal(
    planStepLabel('annotate_map', {
      annotations: [
        { target: 'Capitol' },
        { label: 'Zilker' },
        { target: 'UT' },
      ],
    }),
    'Mark Capitol和Zilker +1',
  );
  assert.equal(
    planStepLabel('fly_to_location', { query: 'Tokyo' }),
    'Fly to Tokyo',
  );
  assert.equal(
    progressStepLabel('resolve', 'Capitol'),
    '正在查找地点: Capitol',
  );
  for (const step of [
    'resolve',
    'search',
    'fly',
    'layer',
    'refresh',
    'nearest',
    'still',
  ]) {
    const line = progressLine(step, 'Austin');
    assertSpeakable(line);
    assert.ok(countWords(line) <= 12);
  }
  assert.equal(
    progressLine('outline', 'Presidio'),
    null,
    'background steps stay on screen',
  );
});
