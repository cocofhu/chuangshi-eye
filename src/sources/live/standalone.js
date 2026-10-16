import {
  epoch,
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  openSkySnapshot,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const header = (response, name) => response.headers?.get?.(name);
const FLIGHT_SOURCE = '民航航班';
const MILITARY_SOURCE = '军用航空器';
const VESSEL_SOURCE = '实时船舶';

function openSkyError(response) {
  const error = httpError(response, FLIGHT_SOURCE);
  const mode = String(
    header(response, 'x-opensky-auth-mode-used') ||
      header(response, 'x-opensky-auth') ||
      '',
  ).toLowerCase();
  const reason = String(
    header(response, 'x-opensky-auth-reason') || '',
  ).toLowerCase();
  if (response.status === 429 && (!mode || mode === 'anon'))
    error.message = 'OpenSky 匿名限流';
  if (response.status === 401 || response.status === 403) {
    const reasons = {
      oauth_invalid_or_missing: 'OpenSky OAuth 客户端缺失或无效',
      oauth_invalid_credentials: 'OpenSky OAuth 拒绝了凭据',
      basic_invalid_credentials: 'OpenSky 用户名或密码被拒绝',
      missing_basic_creds: '缺少 OpenSky 认证',
      missing_oauth_and_basic_creds: '缺少 OpenSky 认证',
      auth_required: '需要 OpenSky 认证',
      forced_anonymous: '需要 OpenSky 认证',
    };
    error.message =
      reasons[reason] ||
      (/^(oauth_|basic_)/.test(reason)
        ? 'OpenSky 认证无效'
        : mode === 'anon'
          ? '需要 OpenSky 认证'
          : 'OpenSky 认证失败');
  }
  return error;
}

/**
 * The provider a feed response names in `X-Feed-Source`, so a server that
 * answers a feed route from another provider is reported as that provider.
 */
function feedSource(response, fallback) {
  const named = header(response, 'x-feed-source');
  return typeof named === 'string' && named.trim()
    ? named.trim().slice(0, 80)
    : fallback;
}

/** The flights feed (/api/flights); no request starts during construction. */
export function createFlightSource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: FLIGHT_SOURCE,
    async getSnapshot(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.latitude) && Number.isFinite(query.longitude)) {
        params.set('lat', query.latitude.toFixed(4));
        params.set('lon', query.longitude.toFixed(4));
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/flights${params.size ? '?' + params : ''}`,
        { signal },
        FLIGHT_SOURCE,
      );
      if (!response.ok) throw openSkyError(response);
      return {
        ...openSkySnapshot(payload, {
          // A fallback provider names itself in X-Flight-Source.
          source:
            header(response, 'x-flight-source') ||
            feedSource(response, FLIGHT_SOURCE),
          coverage:
            header(response, 'x-flight-coverage') ||
            '全球上游快照',
          now: now(),
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/flights/track?icao24=' + encodeURIComponent(reference),
        { signal },
        FLIGHT_SOURCE,
      );
      if (!response.ok) throw httpError(response, FLIGHT_SOURCE);
      return {
        records: normalizeAircraftTrack(payload?.path),
        complete: false,
      };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind))
        throw new LiveSourceError('unsupported', '富集数据不可用');
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsbdb/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
  };
}

export function createMilitarySource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: MILITARY_SOURCE,
    async getIdentities(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        MILITARY_SOURCE,
      );
      if (!response.ok) throw httpError(response, MILITARY_SOURCE);
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        MILITARY_SOURCE,
      );
      if (!response.ok) throw httpError(response, MILITARY_SOURCE);
      const age = finite(header(response, 'x-feed-age-ms'));
      return {
        ...readsbSnapshot(payload, {
          source: feedSource(response, MILITARY_SOURCE),
          observedAtMs: now() - (age != null && age > 0 ? age : 0),
          now: now(),
          stale: header(response, 'x-feed-cache') === 'STALE',
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military/track?hex=' + encodeURIComponent(reference),
        { signal },
        MILITARY_SOURCE,
      );
      if (!response.ok) throw httpError(response, MILITARY_SOURCE);
      const baseTimeMs = epoch(payload?.timestamp, 1000);
      return {
        records:
          baseTimeMs == null
            ? []
            : normalizeAircraftTrack(payload?.trace, {
                baseTimeMs,
                readsb: true,
              }),
        complete: false,
      };
    },
  };
}

export function createVesselSource({
  fetchImpl = defaultFetch,
  apiUrl = '/api/vessels',
  origin = () => globalThis.location?.origin || 'http://localhost',
} = {}) {
  return {
    label: VESSEL_SOURCE,
    async getSnapshot({ maxRows = 12000, area } = {}, { signal } = {}) {
      const url = new URL(apiUrl, origin());
      url.searchParams.set('maxRows', String(maxRows));
      // An area asks for the vessels around a point; servers that hold every
      // vessel may ignore it, since callers still keep only what they need.
      if (
        Number.isFinite(area?.lat) &&
        Number.isFinite(area?.lon) &&
        Number.isFinite(area?.radiusKm)
      ) {
        url.searchParams.set('lat', area.lat.toFixed(5));
        url.searchParams.set('lon', area.lon.toFixed(5));
        url.searchParams.set('radius_km', area.radiusKm.toFixed(1));
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        url.toString(),
        { signal, cache: 'no-store' },
        VESSEL_SOURCE,
      );
      if (!response.ok) {
        const error = httpError(response, VESSEL_SOURCE);
        const reasons = {
          'missing-key': '未设置 AISSTREAM_API_KEY',
          'auth-failed': 'API 密钥被拒绝 — 请检查 AISSTREAM_API_KEY',
          unsupported: '不支持实时数据',
          error: '数据源中断',
          closed: '数据源已断开',
        };
        error.message = reasons[payload?.status] || error.message;
        throw error;
      }
      return {
        ...vesselSnapshot(payload, { source: feedSource(response, VESSEL_SOURCE) }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/vessels/track?mmsi=' + encodeURIComponent(reference),
        { signal },
        VESSEL_SOURCE,
      );
      if (!response.ok) throw httpError(response, VESSEL_SOURCE);
      return {
        records: normalizeVesselTrack(payload?.samples),
        complete: false,
      };
    },
  };
}
