import {
  isValidTiandituTile,
  tiandituUpstreamUrl,
} from '../../../src/china/tianditu.js';
import { sameSiteGated } from '../common/same-site.js';

const MAX_TILE_BYTES = 1024 * 1024;
const MEM_MAX_ENTRIES = 1024;
const TILE_TTL_MS = 24 * 3600_000;

export function tiandituToken(env = process.env) {
  return String(env.TIANDITU_TOKEN || '').trim();
}

/**
 * Tianditu WMTS tile proxy. GET /api/tianditu/status -> {configured};
 * GET /api/tianditu/{layer}/{z}/{x}/{y} -> image. Without TIANDITU_TOKEN the
 * tile route answers 503 without contacting upstream. Same-site only, so the
 * server cannot be used as an open relay for the operator's token.
 */
export function tiandituProxy({
  fetchImpl = fetch,
  env = process.env,
  now = () => Date.now(),
  timeoutMs = 12_000,
} = {}) {
  const mem = new Map();
  const inflight = new Map();

  function remember(key, entry) {
    if (!mem.has(key) && mem.size >= MEM_MAX_ENTRIES)
      mem.delete(mem.keys().next().value);
    mem.delete(key);
    mem.set(key, entry);
  }

  async function fetchTile(layer, z, x, y, token) {
    const response = await fetchImpl(
      tiandituUpstreamUrl(layer, z, x, y, token),
      {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
        headers: {
          Accept: 'image/png,image/jpeg,image/*',
          'User-Agent': 'Mozilla/5.0 (compatible; chuangshi-eye/0.1)',
        },
      },
    );
    const type = String(response.headers.get('content-type') || '');
    if (!response.ok || !type.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error(`tianditu_upstream_${response.status}`);
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_TILE_BYTES)
      throw new Error('tianditu_tile_too_large');
    const buf = Buffer.from(await response.arrayBuffer());
    if (!buf.length || buf.length > MAX_TILE_BYTES)
      throw new Error('tianditu_tile_invalid');
    return { at: now(), type, buf };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    const tile = (entry, cache) => {
      if (res.headersSent) return;
      res.writeHead(200, {
        'Content-Type': entry.type,
        'Cache-Control': 'private, max-age=86400',
        'X-Tianditu-Cache': cache,
      });
      res.end(entry.buf);
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const urlPath = String(req.url || '').split('?')[0];
    if (urlPath === '/status')
      return json(200, { configured: Boolean(tiandituToken(env)) });
    const match = urlPath.match(
      /^\/([a-z]{3})\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/,
    );
    if (!match) return json(404, { error: 'not_found' });
    const [layer, z, x, y] = [
      match[1],
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ];
    if (!isValidTiandituTile(layer, z, x, y))
      return json(400, { error: 'invalid_tile' });
    const token = tiandituToken(env);
    if (!token) return json(503, { error: 'no_key' });
    const key = `${layer}/${z}/${x}/${y}`;
    const cached = mem.get(key);
    if (cached && now() - cached.at < TILE_TTL_MS) return tile(cached, 'HIT');
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchTile(layer, z, x, y, token)
          .then((entry) => {
            remember(key, entry);
            return entry;
          })
          .catch((error) => {
            console.warn(`[tianditu] ${key}: ${error?.message || error}`);
            return null;
          })
          .finally(() => inflight.delete(key)),
      );
    }
    const fresh = await inflight.get(key);
    if (fresh) return tile(fresh, 'MISS');
    if (cached) return tile(cached, 'STALE');
    return json(502, { error: 'upstream' });
  }

  const gated = sameSiteGated(handler);
  return {
    name: 'tianditu-proxy',
    configureServer({ middlewares }) {
      middlewares.use('/api/tianditu', gated);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/tianditu', gated);
    },
  };
}
