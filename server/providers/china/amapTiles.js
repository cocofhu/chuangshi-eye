import {
  amapTileUpstreamUrl,
  isValidAmapTile,
} from '../../../src/china/amapTiles.js';
import { sameSiteGated } from '../common/same-site.js';

const MAX_TILE_BYTES = 1024 * 1024;
const MEM_MAX_ENTRIES = 2048;
const TILE_TTL_MS = 24 * 3600_000;

/**
 * Keyless Amap raster proxy. GET /api/amap-tiles/{anno|vector}/{z}/{x}/{y}.
 * Same-site only, so the app cannot be used as an open tile relay.
 */
export function amapTileProxy({
  fetchImpl = fetch,
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

  async function fetchTile(style, z, x, y) {
    const response = await fetchImpl(amapTileUpstreamUrl(style, z, x, y), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: {
        Accept: 'image/png,image/jpeg,image/*',
        'User-Agent': 'Mozilla/5.0 (compatible; chuangshi-eye/0.1)',
      },
    });
    const type = String(response.headers.get('content-type') || '');
    if (!response.ok || !type.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error(`amap_tile_upstream_${response.status}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (!buf.length || buf.length > MAX_TILE_BYTES)
      throw new Error('amap_tile_invalid');
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
        'Cache-Control': 'public, max-age=86400',
        'X-Amap-Tile-Cache': cache,
      });
      res.end(entry.buf);
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const urlPath = String(req.url || '').split('?')[0];
    const match = urlPath.match(
      /^\/(anno|vector)\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/,
    );
    if (!match) return json(404, { error: 'not_found' });
    const [style, z, x, y] = [
      match[1],
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ];
    if (!isValidAmapTile(style, z, x, y))
      return json(400, { error: 'invalid_tile' });
    const key = `${style}/${z}/${x}/${y}`;
    const cached = mem.get(key);
    if (cached && now() - cached.at < TILE_TTL_MS) return tile(cached, 'HIT');
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchTile(style, z, x, y)
          .then((entry) => {
            remember(key, entry);
            return entry;
          })
          .catch((error) => {
            console.warn(`[amap-tiles] ${key}: ${error?.message || error}`);
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
    name: 'amap-tile-proxy',
    configureServer({ middlewares }) {
      middlewares.use('/api/amap-tiles', gated);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/amap-tiles', gated);
    },
  };
}
