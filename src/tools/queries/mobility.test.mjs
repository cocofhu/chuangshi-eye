import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCatalog, coreTools } from '../index.js';
import { GBFS_CITY_REGISTRY } from '../../layers/bikeshare/registry.js';

const system = (id, city, centerLat, centerLon) => ({
  id,
  city,
  centerLat,
  centerLon,
  loadRadiusKm: 30,
  provider: 'Test Bikes',
  stationInformationUrl: `https://gbfs.example/${id}/station_information.json`,
  stationStatusUrl: `https://gbfs.example/${id}/station_status.json`,
});
const documents = {
  'https://gbfs.example/austin/station_information.json': {
    data: {
      stations: [
        {
          station_id: 's1',
          name: 'Congress & 2nd',
          lat: 30.2645,
          lon: -97.7445,
          capacity: 12,
        },
        {
          station_id: 's2',
          name: 'Far Station',
          lat: 30.4,
          lon: -97.9,
          capacity: 8,
        },
        {
          station_id: 's3',
          name: 'Lamar & 5th',
          lat: 30.268,
          lon: -97.753,
          capacity: '10',
        },
      ],
    },
  },
  'https://gbfs.example/austin/station_status.json': {
    data: {
      stations: [
        {
          station_id: 's1',
          num_bikes_available: 4,
          num_docks_available: 8,
          is_renting: 1,
          last_reported: 1767225600,
        },
        {
          station_id: 's3',
          num_bikes_available: 0,
          num_docks_available: 10,
          is_renting: 0,
        },
      ],
    },
  },
};
const bikeshare = (systems, failing = new Set()) => ({
  systems,
  async getStations(url) {
    if ([...failing].some((id) => url.includes(`/${id}/`)))
      throw new Error('GBFS HTTP 502');
    return documents[url];
  },
});
const downtown = { lat: 30.2672, lon: -97.7431, radius_km: 2 };

test('bike share joins station information with live status inside the area', async () => {
  const catalog = composeCatalog({
    tools: coreTools,
    services: {
      bikeshare: bikeshare([
        system('austin', 'Austin, TX', 30.27, -97.74),
        system('oslo', 'Oslo', 59.9, 10.7),
      ]),
    },
  });
  const result = await catalog.call('get_bike_share', { area: downtown });
  assert.equal(
    result.summary,
    '2 个共享单车站点，位于 30.267, -97.743 周边 2 km，可用 4 辆车。',
  );
  assert.deepEqual(result.data.systems, ['Austin, TX']);
  assert.deepEqual(result.data.rows[0], {
    system: 'Austin, TX',
    provider: 'Test Bikes',
    station_id: 's1',
    name: 'Congress & 2nd',
    lat: 30.2645,
    lon: -97.7445,
    bikes_available: 4,
    docks_available: 8,
    capacity: 12,
    renting: true,
    returning: true,
    last_reported: '2026-01-01T00:00:00.000Z',
    distance_km: 0.33,
  });
  assert.equal(result.data.rows[1].renting, false);
  assert.equal(result.data.rows[1].capacity, 10);
});

test('bike share reports uncovered areas and failed systems honestly', async () => {
  const none = composeCatalog({
    tools: coreTools,
    services: { bikeshare: bikeshare([system('oslo', 'Oslo', 59.9, 10.7)]) },
  });
  const empty = await none.call('get_bike_share', { area: downtown });
  assert.equal(
    empty.summary,
    '没有支持的共享单车系统覆盖 30.267, -97.743 周边 2 km。',
  );
  assert.equal(empty.data.total, 0);
  const both = [
    system('austin', 'Austin, TX', 30.27, -97.74),
    system('round-rock', 'Round Rock', 30.5, -97.68),
  ];
  const partial = composeCatalog({
    tools: coreTools,
    services: { bikeshare: bikeshare(both, new Set(['round-rock'])) },
  });
  assert.match(
    (
      await partial.call('get_bike_share', {
        area: { lat: 30.4, lon: -97.7, radius_km: 20 },
      })
    ).summary,
    /（1 个系统不可用）。$/,
  );
  const down = composeCatalog({
    tools: coreTools,
    services: { bikeshare: bikeshare(both, new Set(['austin', 'round-rock'])) },
  });
  await assert.rejects(
    down.call('get_bike_share', { area: downtown }),
    (error) => error.code === 'unavailable',
  );
});

const feed = {
  id: 'capmetro',
  name: 'CapMetro',
  operator: 'Capital Metro',
  center: { lat: 30.27, lon: -97.74 },
  loadRadiusKm: 50,
  attribution: 'Capital Metro',
  license: 'Open data',
};
const vehicles = [
  {
    id: 'v1',
    lat: 30.2675,
    lon: -97.7425,
    bearing: 91.6,
    speedMps: 8.23,
    timestamp: 1767225600,
    routeId: '1',
    tripId: 't1',
    label: '1 North',
    status: 'IN_TRANSIT_TO',
    occupancy: 'FEW_SEATS_AVAILABLE',
  },
  {
    id: 'v2',
    lat: 30.268,
    lon: -97.745,
    bearing: null,
    speedMps: null,
    timestamp: null,
    routeId: '801',
    label: 'Rapid',
  },
  { id: 'v3', lat: 30.5, lon: -97.6, routeId: '1' },
];
// One minute after v1's fix.
const clock = { now: () => Date.UTC(2026, 0, 1, 0, 1) };
const transit = (
  snapshot = { ok: true, status: 200, json: async () => ({ vehicles }) },
) => ({
  requested: [],
  async getFeeds() {
    return [
      feed,
      { ...feed, id: 'far', name: 'Far Away', center: { lat: 0, lon: 0 } },
    ];
  },
  async requestSnapshot(id) {
    this.requested.push(id);
    return snapshot;
  },
});

test('transit vehicles come from nearby feeds and can be limited to a route', async () => {
  const source = transit();
  const catalog = composeCatalog({
    tools: coreTools,
    services: { transit: source, clock },
  });
  const all = await catalog.call('get_transit_vehicles', { area: downtown });
  assert.equal(
    all.summary,
    '2 辆公交车辆，位于 30.267, -97.743 周边 2 km。',
  );
  assert.deepEqual(source.requested, ['capmetro']);
  assert.deepEqual(all.data.rows[0], {
    feed: 'CapMetro',
    id: 'v1',
    label: '1 North',
    route_id: '1',
    trip_id: 't1',
    lat: 30.2675,
    lon: -97.7425,
    bearing_deg: 92,
    speed_mps: 8.2,
    status: 'IN_TRANSIT_TO',
    occupancy: 'FEW_SEATS_AVAILABLE',
    updated: '2026-01-01T00:00:00.000Z',
    distance_km: 0.07,
  });
  assert.deepEqual(all.data.feeds, [
    {
      name: 'CapMetro',
      status: 'current',
      operator: 'Capital Metro',
      attribution: 'Capital Metro',
      license: 'Open data',
    },
  ]);
  const rapid = await catalog.call('get_transit_vehicles', {
    area: downtown,
    route: 'rapid',
  });
  assert.equal(
    rapid.summary,
    '1 辆公交车辆，线路 rapid，位于 30.267, -97.743 周边 2 km。',
  );
  assert.equal(rapid.data.rows[0].id, 'v2');
});

test('transit reports uncovered areas and unavailable feeds', async () => {
  const catalog = composeCatalog({
    tools: coreTools,
    services: { transit: transit() },
  });
  const oslo = await catalog.call('get_transit_vehicles', {
    area: { lat: 59.9, lon: 10.7, radius_km: 5 },
  });
  assert.equal(
    oslo.summary,
    '没有支持的公交数据源覆盖 59.900, 10.700 周边 5 km。',
  );
  const down = composeCatalog({
    tools: coreTools,
    services: { transit: transit({ ok: false, status: 503 }) },
  });
  await assert.rejects(
    down.call('get_transit_vehicles', { area: downtown }),
    (error) => error.code === 'unavailable',
  );
});

test('traffic flow aggregates speed, congestion and closures by road length', async () => {
  // Two 0.01° segments along the equator (about 1.11 km each) and one closure.
  const segments = [
    {
      coords: [
        [0, 0],
        [0.01, 0],
      ],
      trafficLevel: 1,
      roadCategory: 'motorway',
      closure: false,
    },
    {
      coords: [
        [0, 0.001],
        [0.01, 0.001],
      ],
      trafficLevel: 0.25,
      roadCategory: 'street',
      closure: false,
    },
    {
      coords: [
        [0, 0.002],
        [0.005, 0.002],
      ],
      trafficLevel: 0,
      roadCategory: 'street',
      closure: true,
    },
    { coords: [[0, 0]], trafficLevel: 1 },
  ];
  const zooms = [];
  const traffic = {
    getStatus: async () => ({ hasKey: true }),
    async fetchFlowForBounds(box, { zoom }) {
      zooms.push(zoom);
      if (zoom > 10)
        throw Object.assign(new Error('Zoom in'), {
          code: 'TILE_VIEW_TOO_WIDE',
        });
      return segments;
    },
  };
  const catalog = composeCatalog({ tools: coreTools, services: { traffic } });
  const result = await catalog.call('get_traffic_flow', {
    area: { bbox: [-0.1, -0.1, 0.1, 0.1] },
  });
  assert.deepEqual(zooms, [12, 11, 10]);
  assert.equal(
    result.summary,
    '路况 指定范围：平均自由流速度的 50%；已测 2.8 km 中拥堵 1.7 km；封闭 0.6 km。',
  );
  assert.equal(result.data.speed_pct_of_free_flow, 50);
  assert.deepEqual(result.data.by_category, [
    {
      category: 'street',
      road_km: 1.7,
      speed_pct_of_free_flow: 17,
      congested_km: 1.7,
    },
    {
      category: 'motorway',
      road_km: 1.1,
      speed_pct_of_free_flow: 100,
      congested_km: 0,
    },
  ]);
});

test('traffic reports a missing key, empty areas and areas that are too wide', async () => {
  const keyless = {
    getStatus: async () => ({ hasKey: false }),
    fetchFlowForBounds: async () => [],
  };
  await assert.rejects(
    composeCatalog({ tools: coreTools, services: { traffic: keyless } }).call(
      'get_traffic_flow',
      { area: downtown },
    ),
    (error) => error.code === 'unavailable' && /TomTom key/.test(error.message),
  );
  const quiet = {
    getStatus: async () => ({ hasKey: true }),
    fetchFlowForBounds: async () => [],
  };
  assert.equal(
    (
      await composeCatalog({
        tools: coreTools,
        services: { traffic: quiet },
      }).call('get_traffic_flow', { area: downtown })
    ).summary,
    '30.267, -97.743 周边 2 km 无实时路况报告。',
  );
  const wide = {
    getStatus: async () => ({ hasKey: true }),
    fetchFlowForBounds: async () => {
      throw Object.assign(new Error('Zoom in'), { code: 'TILE_VIEW_TOO_WIDE' });
    },
  };
  await assert.rejects(
    composeCatalog({ tools: coreTools, services: { traffic: wide } }).call(
      'get_traffic_flow',
      { area: { bbox: [-100, 30, -95, 35] } },
    ),
    /too large for traffic detail/,
  );
});

test('transit marks stale feeds and drops expired positions', async () => {
  const headers = new Headers({ 'x-gev-cache': 'STALE-ERROR' });
  const snapshot = (extra) => ({
    ok: true,
    status: 200,
    headers,
    json: async () => ({
      vehicles: [
        vehicles[0],
        { ...vehicles[0], id: 'old', timestamp: 1767225600 - 3600 },
      ],
      ...extra,
    }),
  });
  const result = await composeCatalog({
    tools: coreTools,
    services: { transit: transit(snapshot()), clock },
  }).call('get_transit_vehicles', { area: downtown });
  assert.deepEqual(
    result.data.rows.map((row) => row.id),
    ['v1'],
  );
  assert.equal(result.data.expired_positions_dropped, 1);
  assert.equal(result.data.stale, true);
  assert.equal(result.data.feeds[0].status, 'stale');
  assert.equal(
    result.summary,
    '1 辆公交车辆，位于 30.267, -97.743 周边 2 km（1 个数据源陈旧，位置可能过时）。',
  );
});

test('bike share names the systems it did not search', async () => {
  const empty = { data: { stations: [] } };
  const catalog = composeCatalog({
    tools: coreTools,
    services: {
      bikeshare: {
        systems: GBFS_CITY_REGISTRY,
        getStations: async () => empty,
      },
    },
  });
  // New York, Philadelphia, Washington and Boston.
  const result = await catalog.call('get_bike_share', {
    area: { bbox: [-77.5, 38.5, -70.5, 42.8] },
  });
  assert.equal(result.data.systems.length, 3);
  assert.ok(result.data.systems_not_searched.length >= 1);
  assert.match(
    result.summary,
    /个未搜索：.*；请缩小范围）。$/,
  );
});

test('traffic counts only roads inside a radius area and reports missing tiles', async () => {
  const flow = (segments, partial = false) => ({
    getStatus: async () => ({ hasKey: true }),
    fetchFlowDetail: async () => ({ segments, partial }),
  });
  const call = (traffic, area) =>
    composeCatalog({ tools: coreTools, services: { traffic } }).call(
      'get_traffic_flow',
      { area },
    );
  const circle = { lat: 0, lon: 0, radius_km: 10 };
  // In the circle's bounding box, but about 12.6 km from its center.
  const corner = [
    {
      coords: [
        [0.08, 0.08],
        [0.085, 0.085],
      ],
      closure: true,
      trafficLevel: 1,
    },
  ];
  const outside = await call(flow(corner), circle);
  assert.equal(outside.data.closed_km, 0);
  assert.equal(outside.data.measured_km, 0);
  // A 20 km road through the center keeps the 20 km inside the circle.
  const across = [
    {
      coords: [
        [-0.2, 0],
        [0.2, 0],
      ],
      trafficLevel: 1,
    },
  ];
  const crossing = await call(flow(across), circle);
  assert.ok(Math.abs(crossing.data.measured_km - 20) < 0.2);
  // A road cutting the circle with both ends outside it.
  const chord = [
    {
      coords: [
        [-0.2, 0.05],
        [0.2, 0.05],
      ],
      trafficLevel: 1,
    },
  ];
  assert.ok((await call(flow(chord), circle)).data.measured_km > 10);
  const partial = await call(flow(across, true), circle);
  assert.equal(partial.data.partial, true);
  assert.match(partial.summary, /部分地图瓦片未加载/);
});

test('a whole-world bike-share search names every system it skipped', async () => {
  const empty = { data: { stations: [] } };
  const result = await composeCatalog({
    tools: coreTools,
    services: {
      bikeshare: {
        systems: GBFS_CITY_REGISTRY,
        getStations: async () => empty,
      },
    },
  }).call('get_bike_share', { area: { bbox: [-180, -90, 180, 90] } });
  const named = [...result.data.systems, ...result.data.systems_not_searched];
  assert.equal(named.length, GBFS_CITY_REGISTRY.length);
});
