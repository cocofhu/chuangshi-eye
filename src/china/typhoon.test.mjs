import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrackCone,
  coneRadiusKm,
  nmcStormFromView,
  nmcStormId,
  nmcTime,
  parseNmcList,
  unwrapNmcJsonp,
} from '../../server/providers/china/typhoon.js';
import { cycloneProxy } from '../../server/providers/cyclones.js';
import { validateCycloneSnapshot } from '../layers/cyclones/source.js';

const NOW = Date.UTC(2026, 9, 13, 8, 0, 0);

function trackPoint(time, lon, lat, forecasts) {
  return [
    1,
    time,
    0,
    'STS',
    lon,
    lat,
    985,
    25,
    'NNE',
    20,
    [],
    forecasts ? { BABJ: forecasts } : {},
    [],
  ];
}

const VIEW = {
  typhoon: [
    3346033,
    'KOGUMA',
    '小熊\n',
    2629,
    2629,
    null,
    '小熊星座',
    'start',
    [
      trackPoint('202610130000', 152.8, 33.9),
      trackPoint('202610130600', 153.7, 35.4, [
        [12, '202610130600', 155.0, 37.5, 985, 25, 'BABJ', 'STS'],
        [24, '202610130600', 157.1, 39.9, 988, 23, 'BABJ', 'STS'],
        [48, '202610130600', 160.0, 43.0, 992, 20, 'BABJ', 'TS'],
      ]),
    ],
  ],
};

test('JSONP wrappers with doubled parentheses unwrap', () => {
  assert.deepEqual(unwrapNmcJsonp('cb(({"a":1}))'), { a: 1 });
  assert.deepEqual(unwrapNmcJsonp('cb({"a":2})'), { a: 2 });
  assert.throws(() => unwrapNmcJsonp('nope'));
});

test('ids and times map onto the cyclone contract', () => {
  assert.equal(nmcStormId('2629'), 'wp292026');
  assert.equal(nmcStormId('20260027'), 'wp972026');
  assert.equal(nmcStormId('x'), null);
  assert.equal(nmcTime('202610130600'), '2026-10-13T06:00:00.000Z');
});

test('only active storms are listed', () => {
  const list = parseNmcList({
    typhoonList: [
      [1, 'A', '甲', '2629', '2629', null, null, 'start'],
      [2, 'B', '乙', '2628', '2628', null, null, 'stop'],
    ],
  });
  assert.deepEqual(list, [{ key: 1, code: '2629' }]);
});

test('a detail payload becomes a storm the client contract accepts', () => {
  const storm = nmcStormFromView(VIEW, NOW);
  assert.equal(storm.id, 'wp292026');
  assert.equal(storm.name, '小熊 KOGUMA');
  assert.equal(storm.basin, 'WP');
  assert.equal(storm.windKt, 49);
  assert.equal(storm.movement.directionDegrees, 22.5);
  assert.equal(storm.forecastPoints.length, 3);
  assert.equal(storm.track.type, 'MultiLineString');
  assert.equal(storm.geometryStatus, 'current');
  const snapshot = validateCycloneSnapshot({
    schemaVersion: 1,
    source: 's',
    attribution: 'a',
    coverage: 'c',
    fetchedAt: NOW,
    stale: false,
    unavailable: false,
    reason: null,
    storms: [storm],
  });
  assert.equal(
    snapshot.storms[0].advisoryUrl,
    'https://typhoon.nmc.cn/web.html',
  );
});

test('stale storms are dropped', () => {
  assert.equal(nmcStormFromView(VIEW, NOW + 3 * 24 * 3600_000), null);
});

test('the cone is a closed ring that widens with lead time', () => {
  assert.ok(coneRadiusKm(72) > coneRadiusKm(24));
  const cone = buildTrackCone([
    [150, 30, 0],
    [152, 32, 24],
    [154, 35, 48],
  ]);
  const ring = cone.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(ring.length > 10);
});

test('/api/cyclones serves NMC typhoons even when NHC is unreachable', async () => {
  let handler;
  cycloneProxy({
    fetchImpl: async () => {
      throw new Error('nhc down');
    },
    now: () => NOW,
    typhoons: async () => [nmcStormFromView(VIEW, NOW)],
  }).configureServer({ middlewares: { use: (_p, fn) => (handler = fn) } });
  const body = await new Promise((resolve) => {
    handler(
      { method: 'GET', url: '/' },
      { writeHead() {}, end: resolve, once() {}, removeListener() {} },
    );
  });
  const snapshot = validateCycloneSnapshot(JSON.parse(body));
  assert.equal(snapshot.unavailable, false);
  assert.deepEqual(
    snapshot.storms.map((s) => s.id),
    ['wp292026'],
  );
});
