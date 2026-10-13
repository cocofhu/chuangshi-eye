import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amapCoversRoute,
  amapPathToRoute,
  amapPoisToGeocode,
  amapProxy,
  fetchAmapRoute,
} from '../../server/providers/china/amap.js';
import { wgs84ToGcj02 } from './gcj02.js';

const gcj = (lon, lat) =>
  wgs84ToGcj02(lon, lat)
    .map((v) => v.toFixed(6))
    .join(',');

test('POIs come back in WGS-84 and Google geocode shape', () => {
  const [result] = amapPoisToGeocode([
    {
      name: '天安门',
      location: gcj(116.3913, 39.9075),
      cityname: '北京市',
      adname: '东城区',
      address: '长安街',
    },
    { name: '坏点', location: 'nope' },
  ]);
  assert.equal(result.formatted_address, '天安门 · 北京市东城区长安街');
  assert.ok(Math.abs(result.geometry.location.lng - 116.3913) < 1e-6);
  assert.ok(Math.abs(result.geometry.location.lat - 39.9075) < 1e-6);
});

test('a v5 path becomes the /api/route payload with Chinese steps', () => {
  const route = amapPathToRoute(
    {
      distance: '1200',
      cost: { duration: '300' },
      steps: [
        {
          instruction: '向东行驶200米左转',
          road_name: '长安街',
          step_distance: '200',
          polyline: `${gcj(116.39, 39.9)};${gcj(116.392, 39.9)}`,
        },
        {
          instruction: '到达目的地',
          road_name: '',
          step_distance: '1000',
          polyline: `${gcj(116.392, 39.9)};${gcj(116.4, 39.905)}`,
        },
      ],
    },
    'car',
    true,
  );
  assert.equal(route.ok, true);
  assert.equal(route.distanceM, 1200);
  assert.equal(route.durationS, 300);
  assert.equal(route.geometry.length, 3);
  assert.ok(Math.abs(route.geometry[0][0] - 116.39) < 1e-6);
  assert.equal(route.steps[0].instruction, '向东行驶200米左转');
  assert.equal(route.source, 'amap');
});

test('Amap answers only two-point routes inside China', async () => {
  assert.equal(
    amapCoversRoute([
      [116.39, 39.9],
      [121.47, 31.23],
    ]),
    true,
  );
  assert.equal(
    amapCoversRoute([
      [-97.74, 30.27],
      [-97.7, 30.3],
    ]),
    false,
  );
  let called = false;
  const fetchImpl = async () => {
    called = true;
  };
  assert.equal(
    await fetchAmapRoute({
      profile: 'car',
      points: [
        [-97.74, 30.27],
        [-97.7, 30.3],
      ],
      key: 'k',
      fetchImpl,
    }),
    null,
  );
  assert.equal(
    await fetchAmapRoute({
      profile: 'car',
      points: [
        [116.39, 39.9],
        [116.4, 39.91],
      ],
      key: '',
      fetchImpl,
    }),
    null,
  );
  assert.equal(called, false);
});

test('the request is GCJ-02 and the key stays on the server', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = new URL(url);
    return Response.json({
      status: '1',
      route: {
        paths: [
          {
            distance: '10',
            cost: { duration: '5' },
            steps: [{ polyline: `${gcj(116.39, 39.9)};${gcj(116.391, 39.9)}` }],
          },
        ],
      },
    });
  };
  const route = await fetchAmapRoute({
    profile: 'foot',
    points: [
      [116.39, 39.9],
      [116.391, 39.9],
    ],
    key: 'secret',
    fetchImpl,
  });
  assert.equal(seen.pathname, '/v5/direction/walking');
  assert.equal(seen.searchParams.get('origin'), gcj(116.39, 39.9));
  assert.equal(route.distanceM, 10);
  assert.ok(!JSON.stringify(route).includes('secret'));
});

test('the geocode route reports no key without contacting Amap', async () => {
  let handler;
  amapProxy({
    env: {},
    fetchImpl: async () => assert.fail('no upstream call'),
  }).configureServer({
    middlewares: { use: (_p, fn) => (handler = fn) },
  });
  const call = (url) =>
    new Promise((resolve) => {
      handler(
        { method: 'GET', url, headers: {} },
        {
          headersSent: false,
          writeHead(status) {
            this.status = status;
          },
          end(body) {
            resolve({ status: this.status, body: JSON.parse(body) });
          },
        },
        () => {},
      );
    });
  assert.deepEqual((await call('/status')).body, { configured: false });
  const denied = await call('/geocode?q=%E5%A4%A9%E5%AE%89%E9%97%A8');
  assert.equal(denied.status, 503);
  assert.equal(denied.body.status, 'REQUEST_DENIED');
});
