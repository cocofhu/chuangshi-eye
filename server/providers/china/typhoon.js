import { readResponseTextCapped } from '../common/http.js';

/**
 * 中央气象台台风网 (typhoon.nmc.cn) — western North Pacific and South China
 * Sea typhoons, mapped onto the shared cyclone snapshot contract so the
 * cyclone layer draws them beside NHC/CPHC storms.
 *
 * Upstream rows are positional arrays. A track point is
 * [id, "YYYYMMDDHHmm" (UTC), epochMs, grade, lon, lat, pressureHpa, windMs,
 *  moveDir, moveKmh, windRadii, {BABJ: [[tauH, base, lon, lat, hPa, windMs,
 *  agency, grade], ...]}, localTime].
 */

export const NMC_LIST_URL =
  'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default';
export const NMC_VIEW_URL =
  'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_';
export const NMC_WEB_URL = 'https://typhoon.nmc.cn/web.html';
export const NMC_ATTRIBUTION = '中央气象台台风网 typhoon.nmc.cn';
export const NMC_COVERAGE =
  '西北太平洋与南海台风：中央气象台实况与 BABJ 预报；不确定性锥按典型路径误差半径估算，非官方产品。';

const HOUR = 3600_000;
const MS_TO_KT = 1.943844;
const KMH_TO_KT = 1 / 1.852;
const COMPASS = Object.freeze({
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
});
const GRADES = new Set(['TD', 'TS', 'STS', 'TY', 'STY', 'SuperTY']);
/** Approximate mean track error radius (km) by lead hour; drawn as the cone. */
const CONE_RADIUS_KM = [
  [0, 20],
  [24, 70],
  [48, 120],
  [72, 170],
  [96, 230],
  [120, 290],
];
const EARTH_KM = 6371;

function invalid() {
  return new Error('invalid_typhoon_data');
}

/** Strip the `callback((...))` JSONP wrapper NMC serves. */
export function unwrapNmcJsonp(text) {
  if (typeof text !== 'string') throw invalid();
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) throw invalid();
  let body = text.slice(start + 1, end).trim();
  while (body.startsWith('(') && body.endsWith(')'))
    body = body.slice(1, -1).trim();
  return JSON.parse(body);
}

function finite(value, min, max) {
  const n = Number(value);
  return value !== null &&
    value !== '' &&
    Number.isFinite(n) &&
    n >= min &&
    n <= max
    ? n
    : null;
}

function cleanText(value, max = 40) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001f<>]/g, '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

/** NMC "YYYYMMDDHHmm" in UTC to the cyclone contract's ISO-with-ms form. */
export function nmcTime(value) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(value || ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** "2629" -> wp292026; a nameless depression "20260027" -> wp972026. */
export function nmcStormId(code) {
  const text = String(code ?? '');
  let m = /^(\d\d)(\d\d)$/.exec(text);
  if (m) return `wp${m[2]}20${m[1]}`;
  m = /^(\d{4})00(\d\d)$/.exec(text);
  // JTWC-style 9x numbering keeps depressions clear of named storm numbers.
  if (m) return `wp9${Number(m[2]) % 10}${m[1]}`;
  return null;
}

/** Active rows (status "start") from the list endpoint. */
export function parseNmcList(payload) {
  if (!Array.isArray(payload?.typhoonList)) throw invalid();
  return payload.typhoonList
    .filter((row) => Array.isArray(row) && row[7] === 'start')
    .map((row) => ({
      key: finite(row[0], 1, Number.MAX_SAFE_INTEGER),
      code: String(row[3] ?? row[4] ?? ''),
    }))
    .filter((row) => row.key !== null && nmcStormId(row.code))
    .slice(0, 16);
}

function point(raw) {
  if (!Array.isArray(raw)) return null;
  const lon = finite(raw[4], -180, 180);
  const lat = finite(raw[5], -90, 90);
  const at = nmcTime(raw[1]);
  if (lon === null || lat === null || !at) return null;
  return {
    at,
    grade: GRADES.has(raw[3]) ? raw[3] : null,
    lon,
    lat,
    pressureHpa: finite(raw[6], 800, 1100),
    windMs: finite(raw[7], 0, 150),
    moveDir: typeof raw[8] === 'string' ? (COMPASS[raw[8]] ?? null) : null,
    moveKmh: finite(raw[9], 0, 300),
    forecasts: raw[11]?.BABJ,
  };
}

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Destination point on a sphere; good to well under a kilometre here. */
function destination(lon, lat, bearingDeg, km) {
  const d = km / EARTH_KM;
  const b = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [
    Math.round((((toDeg(l2) + 540) % 360) - 180) * 1e4) / 1e4,
    Math.round(toDeg(p2) * 1e4) / 1e4,
  ];
}

function bearing([lon1, lat1], [lon2, lat2]) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  return (
    (toDeg(
      Math.atan2(
        Math.sin(dl) * Math.cos(p2),
        Math.cos(p1) * Math.sin(p2) -
          Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
      ),
    ) +
      360) %
    360
  );
}

export function coneRadiusKm(tauHours) {
  for (let i = 1; i < CONE_RADIUS_KM.length; i += 1) {
    const [t1, r1] = CONE_RADIUS_KM[i];
    const [t0, r0] = CONE_RADIUS_KM[i - 1];
    if (tauHours <= t1) return r0 + ((r1 - r0) * (tauHours - t0)) / (t1 - t0);
  }
  return CONE_RADIUS_KM.at(-1)[1];
}

/**
 * Cone polygon around [lon, lat, tau] centres: left and right offsets
 * perpendicular to the track, closed by a semicircular cap at the last point.
 */
export function buildTrackCone(centres) {
  if (centres.length < 2) return null;
  const left = [];
  const right = [];
  centres.forEach((c, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const heading = bearing(prev, next);
    const r = coneRadiusKm(c[2]);
    left.push(destination(c[0], c[1], heading - 90, r));
    right.push(destination(c[0], c[1], heading + 90, r));
  });
  const last = centres.at(-1);
  const heading = bearing(centres.at(-2), last);
  const r = coneRadiusKm(last[2]);
  const cap = [];
  for (let a = -90; a <= 90; a += 15)
    cap.push(destination(last[0], last[1], heading + a, r));
  const ring = [...left, ...cap, ...right.reverse()];
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** One NMC detail payload to a cyclone-contract storm, or null if stale/empty. */
export function nmcStormFromView(payload, now = Date.now()) {
  const row = payload?.typhoon;
  if (!Array.isArray(row) || !Array.isArray(row[8])) throw invalid();
  const id = nmcStormId(row[3]);
  if (!id) throw invalid();
  const points = row[8].map(point).filter(Boolean);
  if (!points.length) return null;
  const latest = points.at(-1);
  const at = Date.parse(latest.at);
  if (now - at > 24 * HOUR || at - now > HOUR) return null;
  const cn = cleanText(row[2]);
  const en = cleanText(row[1]);
  const name =
    en && en.toLowerCase() !== 'nameless'
      ? `${cn || en} ${en}`.trim()
      : cn || '热带低压';
  const forecasts = Array.isArray(latest.forecasts)
    ? latest.forecasts
        .map((f) => ({
          tauHours: finite(f?.[0], 1, 168),
          lon: finite(f?.[2], -180, 180),
          lat: finite(f?.[3], -90, 90),
          windMs: finite(f?.[5], 0, 150),
        }))
        .filter((f) => f.tauHours !== null && f.lon !== null && f.lat !== null)
        .filter(
          (f, i, all) => all.findIndex((g) => g.tauHours === f.tauHours) === i,
        )
        .sort((a, b) => a.tauHours - b.tauHours)
        .slice(0, 16)
    : [];
  const kt = (ms) => (ms === null ? null : Math.round(ms * MS_TO_KT));
  const past = points.slice(-200).map((p) => [p.lon, p.lat]);
  const hasForecast = forecasts.length > 0;
  const centres = [
    [latest.lon, latest.lat, 0],
    ...forecasts.map((f) => [f.lon, f.lat, f.tauHours]),
  ];
  const forecastLine = centres.map(([lon, lat]) => [lon, lat]);
  const advisoryNumber = String(Math.min(points.length, 999));
  return {
    id,
    name,
    classification: latest.grade || 'TC',
    basin: 'WP',
    position: { longitude: latest.lon, latitude: latest.lat },
    positionAt: latest.at,
    advisoryNumber,
    issuedAt: latest.at,
    windKt: kt(latest.windMs),
    pressureHpa: latest.pressureHpa,
    movement: {
      directionDegrees: latest.moveDir,
      speedKt:
        latest.moveKmh === null ? null : Math.round(latest.moveKmh * KMH_TO_KT),
    },
    advisoryUrl: NMC_WEB_URL,
    outlookUrl: null,
    geometryStatus: hasForecast ? 'current' : 'unavailable',
    geometryAdvisoryNumber: hasForecast ? advisoryNumber : null,
    forecastPoints: forecasts.map((f) => ({
      position: { longitude: f.lon, latitude: f.lat },
      tauHours: f.tauHours,
      windKt: kt(f.windMs),
      gustKt: null,
    })),
    track: hasForecast
      ? past.length >= 2
        ? { type: 'MultiLineString', coordinates: [past, forecastLine] }
        : { type: 'LineString', coordinates: forecastLine }
      : null,
    cone: hasForecast ? buildTrackCone(centres) : null,
  };
}

/** Fetch every active NMC typhoon; bounded bodies, fixed official endpoints. */
export async function fetchNmcTyphoons({
  fetchImpl = fetch,
  signal,
  now = Date.now(),
} = {}) {
  const read = async (url, cap) => {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: {
        Accept: 'application/javascript,application/json,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; chuangshi-eye/0.1)',
        Referer: NMC_WEB_URL,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('typhoon_upstream_unavailable');
    }
    return unwrapNmcJsonp(await readResponseTextCapped(response, cap, signal));
  };
  const active = parseNmcList(await read(NMC_LIST_URL, 256 * 1024));
  const storms = [];
  const seen = new Set();
  for (const { key } of active) {
    const storm = nmcStormFromView(
      await read(`${NMC_VIEW_URL}${key}`, 2 * 1024 * 1024),
      now,
    );
    if (storm && !seen.has(storm.id)) {
      seen.add(storm.id);
      storms.push(storm);
    }
  }
  return storms;
}
