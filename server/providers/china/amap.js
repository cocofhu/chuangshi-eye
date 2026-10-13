import { readResponseJsonCapped } from '../common/http.js';
import { sameSiteGated } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  amapLocationToWgs84,
  amapPolylineToWgs84,
  outOfChina,
  wgs84ToGcj02,
} from '../../../src/china/gcj02.js';

const AMAP_BASE = 'https://restapi.amap.com';
const AMAP_ROUTE_PATHS = Object.freeze({
  car: '/v5/direction/driving',
  foot: '/v5/direction/walking',
  bike: '/v5/direction/bicycling',
});
export const AMAP_ATTRIBUTION = '© 高德地图 AutoNavi';

export function amapKey(env = process.env) {
  return String(env.AMAP_KEY || '').trim();
}

const cleanText = (value, max = 120) =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u001f<>]/g, '').slice(0, max)
    : '';

function gcjParam(lon, lat) {
  const [x, y] = wgs84ToGcj02(lon, lat);
  return `${x.toFixed(6)},${y.toFixed(6)}`;
}

async function amapGet(path, params, { key, fetchImpl, signal }) {
  const url = new URL(path, AMAP_BASE);
  for (const [name, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(name, String(value));
  url.searchParams.set('key', key);
  const response = await fetchImpl(url, {
    signal,
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`amap_http_${response.status}`);
  }
  const data = await readResponseJsonCapped(response, 4 * 1024 * 1024, signal);
  if (String(data?.status) !== '1')
    throw Object.assign(new Error('amap_rejected'), {
      info: cleanText(data?.info, 60),
    });
  return data;
}

/** Amap POIs as Google-geocode-shaped results in WGS-84. */
export function amapPoisToGeocode(pois) {
  const results = [];
  for (const poi of Array.isArray(pois) ? pois : []) {
    const point = amapLocationToWgs84(poi?.location);
    if (!point) continue;
    const name = cleanText(poi.name);
    const address = [poi.cityname, poi.adname, poi.address]
      .map((part) => cleanText(part, 60))
      .filter(Boolean)
      .join('');
    results.push({
      formatted_address: address ? `${name} · ${address}` : name,
      geometry: { location: { lat: point[1], lng: point[0] } },
      types: ['point_of_interest'],
      address_components: [{ long_name: name, types: ['point_of_interest'] }],
    });
    if (results.length >= 10) break;
  }
  return results;
}

/** Amap v5 path to the /api/route payload shape, converted to WGS-84. */
export function amapPathToRoute(path, profile, withSteps) {
  const geometry = [];
  const steps = [];
  for (const raw of Array.isArray(path?.steps) ? path.steps : []) {
    const line = amapPolylineToWgs84(raw?.polyline);
    if (!line.length) continue;
    for (const point of line) {
      const last = geometry[geometry.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1])
        geometry.push(point);
    }
    if (withSteps && steps.length < 200) {
      steps.push({
        index: steps.length,
        type: 'continue',
        modifier: null,
        exit: null,
        name: cleanText(raw.road_name),
        ref: null,
        distanceM: Math.max(0, Math.round(Number(raw.step_distance) || 0)),
        durationS: Math.max(0, Math.round(Number(raw.cost?.duration) || 0)),
        lon: Number(line[0][0].toFixed(6)),
        lat: Number(line[0][1].toFixed(6)),
        instruction: cleanText(raw.instruction, 200),
      });
    }
  }
  const distance = Number(path?.distance);
  const duration = Number(path?.cost?.duration ?? path?.duration);
  if (geometry.length < 2 || !Number.isFinite(distance)) return null;
  return {
    ok: true,
    profile,
    distanceM: Math.round(distance),
    durationS: Number.isFinite(duration) ? Math.round(duration) : null,
    geometry,
    source: 'amap',
    ...(withSteps ? { steps } : {}),
  };
}

/** True when every point is inside mainland China (Amap coverage). */
export function amapCoversRoute(points) {
  return (
    points.length === 2 && points.every(([lon, lat]) => !outOfChina(lon, lat))
  );
}

/** One Amap route between two WGS-84 points, or null when Amap has none. */
export async function fetchAmapRoute({
  profile,
  points,
  withSteps,
  key,
  fetchImpl = fetch,
  signal,
}) {
  const path = AMAP_ROUTE_PATHS[profile];
  if (!path || !key || !amapCoversRoute(points)) return null;
  const [[ax, ay], [bx, by]] = points;
  const data = await amapGet(
    path,
    {
      origin: gcjParam(ax, ay),
      destination: gcjParam(bx, by),
      show_fields: 'cost,polyline',
    },
    { key, fetchImpl, signal },
  );
  const paths = data?.route?.paths;
  return Array.isArray(paths) && paths[0]
    ? amapPathToRoute(paths[0], profile, withSteps)
    : null;
}

/** Amap traffic roads ({name, status, speed, polyline}) as WGS-84 lines. */
export function amapTrafficRoads(roads) {
  const out = [];
  for (const road of Array.isArray(roads) ? roads : []) {
    const line = amapPolylineToWgs84(road?.polyline);
    const status = Number(road?.status);
    if (
      line.length < 2 ||
      !Number.isInteger(status) ||
      status < 0 ||
      status > 4
    )
      continue;
    const speed = Number(road.speed);
    out.push({
      name: cleanText(road.name, 60),
      status,
      speedKmh: Number.isFinite(speed) ? speed : null,
      line: line.map(([lon, lat]) => [
        Number(lon.toFixed(6)),
        Number(lat.toFixed(6)),
      ]),
    });
    if (out.length >= 400) break;
  }
  return out;
}

/**
 * /api/amap/status, /api/amap/geocode?q=&near=lon,lat and
 * /api/amap/traffic?lon=&lat= (about 6 × 5 km around the point). Keyword search
 * answers in Google geocode shape so the existing place-search adapter reads
 * it; coordinates are converted from GCJ-02 before leaving the server.
 */
export function amapProxy({ fetchImpl = fetch, env = process.env } = {}) {
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 300,
  });
  const cache = new Map();
  const trafficCache = new Map();

  async function traffic(url, req, key, json) {
    const lon = Number(url.searchParams.get('lon'));
    const lat = Number(url.searchParams.get('lat'));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || outOfChina(lon, lat))
      return json(400, { error: 'outside_coverage' });
    const cellLon = Math.round(lon / 0.02) * 0.02;
    const cellLat = Math.round(lat / 0.02) * 0.02;
    const cacheKey = `${cellLon.toFixed(2)},${cellLat.toFixed(2)}`;
    const hit = trafficCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 120_000) return json(200, hit.value);
    if (!limiter(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const data = await amapGet(
        '/v3/traffic/status/rectangle',
        {
          rectangle: `${gcjParam(cellLon - 0.03, cellLat - 0.022)};${gcjParam(cellLon + 0.03, cellLat + 0.022)}`,
          extensions: 'all',
          level: 5,
        },
        { key, fetchImpl, signal: AbortSignal.timeout(8000) },
      );
      const value = {
        center: [cellLon, cellLat],
        description: cleanText(data?.trafficinfo?.description, 300),
        roads: amapTrafficRoads(data?.trafficinfo?.roads),
        fetchedAt: Date.now(),
        attribution: AMAP_ATTRIBUTION,
      };
      trafficCache.set(cacheKey, { at: Date.now(), value });
      if (trafficCache.size > 200)
        trafficCache.delete(trafficCache.keys().next().value);
      json(200, value);
    } catch (error) {
      console.warn('[amap] traffic failed:', error?.info || error?.message);
      json(502, { error: 'upstream' });
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
    const url = new URL(req.url || '/', 'http://localhost');
    const key = amapKey(env);
    if (url.pathname === '/status')
      return json(200, { configured: Boolean(key) });
    if (url.pathname !== '/geocode' && url.pathname !== '/traffic')
      return json(404, { error: 'not_found' });
    if (!key) return json(503, { status: 'REQUEST_DENIED', error: 'no_key' });
    if (url.pathname === '/traffic') return traffic(url, req, key, json);
    const query = cleanText(url.searchParams.get('q'), 80).trim();
    if (!query) return json(400, { status: 'INVALID_REQUEST' });
    if (!limiter(clientKey(req)))
      return json(429, { status: 'OVER_QUERY_LIMIT' });
    let region = '';
    const near = (url.searchParams.get('near') || '').split(',').map(Number);
    if (
      near.length === 2 &&
      near.every(Number.isFinite) &&
      !outOfChina(near[0], near[1])
    )
      region = gcjParam(near[0], near[1]);
    const cacheKey = `${query}|${region}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < 3600_000) return json(200, hit.value);
    try {
      const data = await amapGet(
        '/v5/place/text',
        { keywords: query, location: region, page_size: 10 },
        { key, fetchImpl, signal: AbortSignal.timeout(8000) },
      );
      const results = amapPoisToGeocode(data?.pois);
      const value = {
        status: results.length ? 'OK' : 'ZERO_RESULTS',
        results,
        attribution: AMAP_ATTRIBUTION,
      };
      cache.set(cacheKey, { at: Date.now(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      json(200, value);
    } catch (error) {
      console.warn('[amap] geocode failed:', error?.info || error?.message);
      json(502, { status: 'UNKNOWN_ERROR' });
    }
  }

  const gated = sameSiteGated(handler);
  return {
    name: 'amap',
    configureServer({ middlewares }) {
      middlewares.use('/api/amap', gated);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/amap', gated);
    },
  };
}
