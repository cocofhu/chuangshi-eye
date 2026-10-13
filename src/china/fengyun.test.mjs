import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FY4B_GRID_4KM,
  FY4B_SUB_LONGITUDE,
  fengyunRectangle,
  geosPixel,
  reprojectDisk,
} from './fengyun.js';
import { fengyunProxy } from '../../server/providers/china/fengyun.js';

test('the sub-satellite point is the disk centre and the far side is hidden', () => {
  const centre = geosPixel(0, FY4B_SUB_LONGITUDE);
  assert.ok(Math.abs(centre.column - (FY4B_GRID_4KM.coff - 0.5)) < 1e-9);
  assert.ok(Math.abs(centre.line - (FY4B_GRID_4KM.loff - 0.5)) < 1e-9);
  assert.equal(geosPixel(0, FY4B_SUB_LONGITUDE + 100), null);
  const beijing = geosPixel(39.9, 116.4);
  assert.ok(beijing.line < centre.line, 'north is up');
  assert.ok(beijing.column > centre.column, 'east is right');
});

test('the visible limb stays inside the 4 km grid', () => {
  for (let lon = -80; lon <= 80; lon += 5) {
    for (let lat = -80; lat <= 80; lat += 5) {
      const p = geosPixel(lat, FY4B_SUB_LONGITUDE + lon);
      if (!p) continue;
      assert.ok(p.column > -1 && p.column < FY4B_GRID_4KM.size);
      assert.ok(p.line > -1 && p.line < FY4B_GRID_4KM.size);
    }
  }
});

test('reprojection keeps the disk and makes space transparent', () => {
  const size = FY4B_GRID_4KM.size;
  const rgb = new Uint8Array(size * size * 3).fill(200);
  const out = reprojectDisk(
    rgb,
    { width: size, height: size },
    { outWidth: 64, outHeight: 64 },
  );
  const alpha = (row, col) => out[(row * 64 + col) * 4 + 3];
  assert.equal(alpha(32, 32), 255);
  assert.equal(alpha(0, 0), 0);
  const r = fengyunRectangle();
  assert.equal(r.east - r.west, 150);
});

test('upstream is re-downloaded only when Last-Modified changes', async () => {
  let clock = 0;
  let modified = 'Tue, 13 Oct 2026 08:29:07 GMT';
  const calls = [];
  let renders = 0;
  const fetchImpl = async (_url, options = {}) => {
    calls.push(options.method || 'GET');
    return new Response(
      options.method === 'HEAD' ? null : new Uint8Array([1, 2, 3]),
      {
        headers: { 'content-type': 'image/jpeg', 'last-modified': modified },
      },
    );
  };
  let handler;
  fengyunProxy({
    fetchImpl,
    now: () => clock,
    render: async () => {
      renders++;
      return Buffer.from('webp');
    },
  }).configureServer({ middlewares: { use: (_p, fn) => (handler = fn) } });
  const get = (url) =>
    new Promise((resolve) => {
      const res = {
        headersSent: false,
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers;
        },
        end(body) {
          resolve({
            status: this.status,
            headers: this.headers,
            body: String(body),
          });
        },
      };
      handler({ method: 'GET', url, headers: {} }, res, () => {});
    });
  const status = JSON.parse((await get('/status')).body);
  assert.equal(status.satellite, 'FY-4B');
  assert.equal(status.observedAt, Date.parse(modified));
  assert.equal((await get('/fy4b.webp')).headers['Content-Type'], 'image/webp');
  assert.deepEqual(calls, ['HEAD', 'GET']);
  clock += 11 * 60_000;
  await get('/status');
  assert.deepEqual(calls, ['HEAD', 'GET', 'HEAD']);
  modified = 'Tue, 13 Oct 2026 08:44:07 GMT';
  clock += 11 * 60_000;
  await get('/status');
  assert.deepEqual(calls, ['HEAD', 'GET', 'HEAD', 'HEAD', 'GET']);
  assert.equal(renders, 2);
  assert.equal((await get('/other')).status, 404);
});
