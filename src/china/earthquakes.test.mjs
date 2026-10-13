import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cencTime,
  createChinaEarthquakeSource,
  mergeEarthquakeRows,
  parseCencCatalog,
  cencRows,
} from './earthquakes.js';

const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);

test('CENC timestamps are Beijing time', () => {
  assert.equal(
    cencTime('2026-10-13 16:15:03'),
    Date.UTC(2026, 9, 13, 8, 15, 3),
  );
  assert.equal(cencTime('13/10/2026'), null);
});

test('the catalog keeps valid M2.5+ events from the last 24 hours', () => {
  const events = parseCencCatalog(
    [
      {
        id: 'a',
        time: '2026-10-13 16:15:03',
        latitude: 38.75,
        longitude: 104.68,
        depth: 10,
        magnitude: 4.4,
        location: '内蒙古阿拉善盟阿拉善左旗',
      },
      {
        id: 'b',
        time: '2026-10-11 10:00:00',
        latitude: 30,
        longitude: 100,
        depth: 10,
        magnitude: 5,
        location: '旧事件',
      },
      {
        id: 'c',
        time: '2026-10-13 15:00:00',
        latitude: 30,
        longitude: 100,
        depth: 10,
        magnitude: 2.0,
        location: '小震',
      },
      {
        id: 'd',
        time: '2026-10-13 15:00:00',
        latitude: 300,
        longitude: 100,
        depth: 10,
        magnitude: 3,
        location: '坏坐标',
      },
      {
        id: 'a',
        time: '2026-10-13 16:15:03',
        latitude: 38.75,
        longitude: 104.68,
        depth: 10,
        magnitude: 4.4,
        location: '重复',
      },
    ],
    NOW,
  );
  assert.deepEqual(
    events.map((e) => e.id),
    ['a'],
  );
  assert.equal(events[0].place, '内蒙古阿拉善盟阿拉善左旗');
  assert.throws(() => parseCencCatalog({}), /invalid_cenc_catalog/);
});

test('an event both agencies report is kept once, as the CENC row', () => {
  const cenc = cencRows([
    {
      id: 'CC.1',
      lon: 104.68,
      lat: 38.75,
      depthKm: 10,
      mag: 4.4,
      place: '阿拉善左旗',
      time: NOW,
    },
  ]);
  const usgs = [
    {
      stableId: 'us1',
      usgsId: 'us1',
      lon: 104.7,
      lat: 38.8,
      depthKm: 10,
      mag: 4.5,
      place: 'Inner Mongolia',
      time: NOW + 20_000,
    },
    {
      stableId: 'us2',
      usgsId: 'us2',
      lon: -81.4,
      lat: 7.65,
      depthKm: 10,
      mag: 6.1,
      place: 'south of Panama',
      time: NOW,
    },
  ];
  const rows = mergeEarthquakeRows(usgs, cenc);
  assert.deepEqual(
    rows.map((r) => r.stableId),
    ['cenc:CC.1', 'us2'],
  );
  assert.equal(rows[0].source, '中国地震台网');
  assert.equal(rows[1].source, 'USGS');
});

test('either feed alone is enough; both failing fails the snapshot', async () => {
  const usgsOk = {
    getSnapshot: async () => [
      { stableId: 'u', usgsId: 'u', lon: 0, lat: 0, mag: 3, time: NOW },
    ],
  };
  const usgsDown = {
    getSnapshot: async () => {
      throw new Error('usgs down');
    },
  };
  const cencOk = async () =>
    Response.json({
      events: [
        {
          id: 'c',
          lon: 100,
          lat: 30,
          mag: 3,
          depthKm: 5,
          place: '四川',
          time: NOW,
        },
      ],
    });
  const cencDown = async () => new Response('', { status: 502 });

  const a = await createChinaEarthquakeSource({
    usgs: usgsDown,
    fetchImpl: cencOk,
  }).getSnapshot();
  assert.deepEqual(
    a.map((r) => r.stableId),
    ['cenc:c'],
  );
  const b = await createChinaEarthquakeSource({
    usgs: usgsOk,
    fetchImpl: cencDown,
  }).getSnapshot();
  assert.deepEqual(
    b.map((r) => r.stableId),
    ['u'],
  );
  await assert.rejects(
    createChinaEarthquakeSource({
      usgs: usgsDown,
      fetchImpl: cencDown,
    }).getSnapshot(),
    /usgs down/,
  );
});
