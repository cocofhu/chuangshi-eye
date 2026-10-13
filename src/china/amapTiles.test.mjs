import test from 'node:test';
import assert from 'node:assert/strict';
import { amapTileUpstreamUrl, isValidAmapTile } from './amapTiles.js';
import { amapTileProxy } from '../../server/providers/china/amapTiles.js';

function mount(options) {
  let handler;
  amapTileProxy(options).configureServer({
    middlewares: { use: (_path, fn) => (handler = fn) },
  });
  return (url, headers = {}) =>
    new Promise((resolve) => {
      const res = {
        headersSent: false,
        status: 0,
        headers: {},
        writeHead(status, h) {
          this.status = status;
          this.headers = h;
          this.headersSent = true;
        },
        setHeader(k, v) {
          this.headers[k] = v;
        },
        end(body) {
          resolve({
            status: this.status || this.statusCode,
            headers: this.headers,
            body,
          });
        },
      };
      handler(
        { method: 'GET', url, headers: { host: 'localhost:4173', ...headers } },
        res,
      );
    });
}

test('tile addresses stay inside the style and the zoom pyramid', () => {
  assert.equal(isValidAmapTile('anno', 2, 3, 1), true);
  assert.equal(isValidAmapTile('vector', 2, 4, 0), false);
  assert.equal(isValidAmapTile('sat', 2, 0, 0), false);
  assert.match(amapTileUpstreamUrl('anno', 3, 1, 2), /webst04\.is\.autonavi\.com/);
  assert.match(amapTileUpstreamUrl('vector', 3, 1, 2), /webrd04\.is\.autonavi\.com/);
});

test('the proxy caches one upstream image and refuses cross-site use', async () => {
  let calls = 0;
  const request = mount({
    fetchImpl: () => {
      calls += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
  });
  const first = await request('/anno/3/1/2');
  const second = await request('/anno/3/1/2');
  assert.equal(first.status, 200);
  assert.equal(second.headers['X-Amap-Tile-Cache'], 'HIT');
  assert.equal(calls, 1);
  const blocked = await request('/vector/3/1/2', {
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
  });
  assert.equal(blocked.status, 403);
  assert.equal((await request('/anno/3/9/0')).status, 400);
});
