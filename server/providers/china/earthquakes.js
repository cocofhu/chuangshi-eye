import { readResponseTextCapped } from '../common/http.js';
import { sameSiteGated } from '../common/same-site.js';
import { parseCencCatalog } from '../../../src/china/earthquakes.js';

export const CENC_DATA_URL = 'https://www.ceic.ac.cn/data/data.json';
const CACHE_MS = 60_000;
const STALE_MS = 6 * 3600_000;

/**
 * 中国地震台网 (CENC) rapid reports. GET /api/cenc/earthquakes returns the
 * last 24 hours, normalized to the same row shape as the USGS feed. One
 * shared refresh per minute; the last good catalog is served for six hours
 * while the upstream is unreachable.
 */
export function cencEarthquakeProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 12_000,
} = {}) {
  let cache = null;
  let inflight = null;

  async function refresh() {
    const response = await fetchImpl(CENC_DATA_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; chuangshi-eye/0.1)',
        Referer: 'https://www.ceic.ac.cn/',
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`cenc_upstream_${response.status}`);
    }
    const text = await readResponseTextCapped(response, 4 * 1024 * 1024);
    const events = parseCencCatalog(JSON.parse(text), now());
    cache = { events, fetchedAt: now() };
    return cache;
  }

  async function acquire() {
    if (cache && now() - cache.fetchedAt < CACHE_MS) return { value: cache };
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    try {
      return { value: await inflight };
    } catch (error) {
      if (cache && now() - cache.fetchedAt < STALE_MS)
        return { value: cache, stale: true };
      throw error;
    }
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
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const urlPath = String(req.url || '').split('?')[0];
    if (urlPath !== '/' && urlPath !== '')
      return json(404, { error: 'not_found' });
    try {
      const { value, stale = false } = await acquire();
      json(200, {
        source: '中国地震台网',
        attribution: '中国地震台网中心 www.ceic.ac.cn',
        fetchedAt: value.fetchedAt,
        stale,
        events: value.events,
      });
    } catch (error) {
      console.warn('[cenc] unavailable:', error?.message || error);
      json(502, { error: 'upstream' });
    }
  }

  const gated = sameSiteGated(handler);
  return {
    name: 'cenc-earthquakes',
    configureServer({ middlewares }) {
      middlewares.use('/api/cenc/earthquakes', gated);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/cenc/earthquakes', gated);
    },
  };
}
