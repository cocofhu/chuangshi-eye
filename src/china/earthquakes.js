/**
 * 中国地震台网 (CENC) rapid reports, merged with the USGS feed.
 *
 * CENC publishes more small mainland events and Chinese place names; USGS
 * covers the rest of the world. An event both agencies report is kept once,
 * as the CENC row.
 */

const BEIJING_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;
const MIN_MAGNITUDE = 2.5;
const SAME_EVENT_SECONDS = 120;
const SAME_EVENT_KM = 150;
const SAME_EVENT_MAG = 1.0;

/** "2026-10-13 16:15:03" in Beijing time (UTC+8) to epoch milliseconds. */
export function cencTime(value) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(
    String(value || ''),
  );
  if (!m) return null;
  const ms =
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - BEIJING_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

/** Validate the CENC catalog and keep M2.5+ events from the last 24 hours. */
export function parseCencCatalog(payload, now = Date.now()) {
  if (!Array.isArray(payload)) throw new Error('invalid_cenc_catalog');
  const events = [];
  const ids = new Set();
  for (const row of payload) {
    const time = cencTime(row?.time);
    const lon = Number(row?.longitude);
    const lat = Number(row?.latitude);
    const mag = Number(row?.magnitude);
    const depth = Number(row?.depth);
    const id = typeof row?.id === 'string' ? row.id.slice(0, 64) : '';
    if (
      !id ||
      ids.has(id) ||
      time === null ||
      now - time > DAY_MS ||
      time - now > 3600_000 ||
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(mag) ||
      mag < MIN_MAGNITUDE ||
      mag > 10
    )
      continue;
    ids.add(id);
    const place =
      typeof row.location === 'string'
        ? row.location.replace(/[\u0000-\u001f<>]/g, '').slice(0, 80)
        : null;
    events.push({
      id,
      lon,
      lat,
      depthKm:
        Number.isFinite(depth) && depth >= 0 && depth < 1000 ? depth : null,
      mag,
      place,
      time,
    });
  }
  return events;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isSameEarthquake(a, b) {
  return (
    Number.isFinite(a.time) &&
    Number.isFinite(b.time) &&
    Math.abs(a.time - b.time) <= SAME_EVENT_SECONDS * 1000 &&
    Math.abs(a.mag - b.mag) <= SAME_EVENT_MAG &&
    haversineKm(a.lat, a.lon, b.lat, b.lon) <= SAME_EVENT_KM
  );
}

/** CENC events in the earthquake layer's row shape. */
export function cencRows(events) {
  return events.map((event) => ({
    stableId: `cenc:${event.id}`,
    usgsId: null,
    cencId: event.id,
    lon: event.lon,
    lat: event.lat,
    depthKm: event.depthKm,
    mag: event.mag,
    place: event.place,
    time: event.time,
    source: '中国地震台网',
  }));
}

/** Union of both feeds with duplicates resolved toward the CENC row. */
export function mergeEarthquakeRows(usgsRows, cencRowsList) {
  const kept = usgsRows.filter(
    (row) => !cencRowsList.some((cenc) => isSameEarthquake(row, cenc)),
  );
  return [...cencRowsList, ...kept.map((row) => ({ source: 'USGS', ...row }))];
}

/**
 * Snapshot source combining USGS with `/api/cenc/earthquakes`. Either feed
 * alone is enough; the snapshot fails only when both do.
 */
export function createChinaEarthquakeSource({
  usgs,
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/cenc/earthquakes',
} = {}) {
  if (typeof usgs?.getSnapshot !== 'function')
    throw new TypeError('A USGS snapshot source is required');
  async function cenc(signal) {
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(`CENC HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.events))
      throw new Error('Malformed CENC response');
    return cencRows(payload.events);
  }
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const [world, china] = await Promise.allSettled([
        usgs.getSnapshot({ signal }),
        cenc(signal),
      ]);
      signal?.throwIfAborted();
      if (world.status === 'rejected' && china.status === 'rejected')
        throw world.reason;
      return mergeEarthquakeRows(
        world.status === 'fulfilled' ? world.value : [],
        china.status === 'fulfilled' ? china.value : [],
      );
    },
  };
}
