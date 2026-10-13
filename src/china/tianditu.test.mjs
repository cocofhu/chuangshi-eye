import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTiandituTile, tiandituUpstreamUrl } from './tianditu.js';
import { tiandituProxy } from '../../server/providers/china/tianditu.js';
import { createDefaultMapSources } from '../maps/defaultSources.js';

function mount(options) {
  let handler;
  tiandituProxy(options).configureServer({
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
          this.status ||= this.statusCode;
          resolve({ status: this.status, headers: this.headers, body });
        },
      };
      handler(
        { method: 'GET', url, headers: { host: 'localhost:4173', ...headers } },
        res,
      );
    });
}

function imageResponse() {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

test('tile validation follows each layer level range', () => {
  assert.equal(isValidTiandituTile('img', 18, 1, 1), true);
  assert.equal(isValidTiandituTile('ter', 15, 1, 1), false);
  assert.equal(isValidTiandituTile('img', 2, 4, 0), false);
  assert.equal(isValidTiandituTile('img', 0, 0, 0), false);
  assert.equal(isValidTiandituTile('xyz', 3, 0, 0), false);
});

test('upstream URL uses the Web Mercator matrix set and the token', () => {
  const url = new URL(tiandituUpstreamUrl('cia', 5, 26, 12, 'abc'));
  assert.match(url.hostname, /^t[0-7]\.tianditu\.gov\.cn$/);
  assert.equal(url.pathname, '/cia_w/wmts');
  assert.equal(url.searchParams.get('TILEMATRIXSET'), 'w');
  assert.equal(url.searchParams.get('TILEROW'), '12');
  assert.equal(url.searchParams.get('TILECOL'), '26');
  assert.equal(url.searchParams.get('tk'), 'abc');
});

test('without a token the proxy refuses tiles and never calls upstream', async () => {
  let calls = 0;
  const request = mount({
    env: {},
    fetchImpl: () => (calls++, imageResponse()),
  });
  assert.deepEqual(JSON.parse((await request('/status')).body), {
    configured: false,
  });
  assert.equal((await request('/img/3/1/1')).status, 503);
  assert.equal(calls, 0);
});

test('tiles are fetched once, cached, and the token is never echoed', async () => {
  const seen = [];
  const request = mount({
    env: { TIANDITU_TOKEN: 'secret-token' },
    fetchImpl: (url) => (seen.push(url), imageResponse()),
  });
  const first = await request('/img/3/6/3');
  const second = await request('/img/3/6/3');
  assert.equal(first.status, 200);
  assert.equal(first.headers['Content-Type'], 'image/png');
  assert.equal(first.headers['X-Tianditu-Cache'], 'MISS');
  assert.equal(second.headers['X-Tianditu-Cache'], 'HIT');
  assert.equal(seen.length, 1);
  assert.ok(!JSON.stringify(first.headers).includes('secret-token'));
});

test('a non-image upstream answer is treated as a failure', async () => {
  const request = mount({
    env: { TIANDITU_TOKEN: 't' },
    fetchImpl: () =>
      new Response('<xml>error</xml>', {
        status: 200,
        headers: { 'content-type': 'text/xml' },
      }),
  });
  assert.equal((await request('/vec/4/1/1')).status, 502);
});

test('cross-site requests are refused before reaching upstream', async () => {
  let calls = 0;
  const request = mount({
    env: { TIANDITU_TOKEN: 't' },
    fetchImpl: () => (calls++, imageResponse()),
  });
  const result = await request('/img/3/1/1', {
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
  });
  assert.equal(result.status, 403);
  assert.equal(calls, 0);
});

test('Tianditu becomes the keyless default only when a token is configured', () => {
  const without = createDefaultMapSources();
  assert.equal(without.defaultId, 'amap-satellite');
  const amap = without.sources.find(
    (s) => s.descriptor.id === 'amap-satellite',
  );
  assert.equal(typeof amap.overlayImagery, 'function');
  assert.equal(amap.tileFailureFallback.id, 'osm');
  const tdt = without.sources.find((s) => s.descriptor.id === 'tdt-imagery');
  assert.equal(tdt.available, false);
  assert.match(tdt.unavailableReason, /TIANDITU_TOKEN/);

  const withToken = createDefaultMapSources({ tiandituEnabled: true });
  assert.equal(withToken.defaultId, 'tdt-imagery');
  const source = withToken.sources.find(
    (s) => s.descriptor.id === 'tdt-imagery',
  );
  assert.equal(source.available, true);
  assert.equal(typeof source.overlayImagery, 'function');
  assert.equal(source.constructionFallback.id, 'esri-imagery');
});
