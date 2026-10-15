import {
  IMAGE_FIELDS,
  MAPILLARY_GRAPH_HOST,
  NEAREST_LIMIT,
  NEAREST_RADIUS_M,
  SEQUENCE_IMAGE_FIELDS,
  SEQUENCE_IMAGES_LIMIT,
} from './policy.js';

const MAPILLARY_ERROR_TEXT = Object.freeze({
  no_key: '需要 MAPILLARY_CLIENT_TOKEN',
  'Too many tile requests': '瓦片请求过多',
  'Tile path must be /coverage/{z}/{x}/{y}': '瓦片路径无效',
  'Mapillary rejected the access token': 'Mapillary 拒绝了访问令牌',
  'Mapillary is rate-limiting tile requests': 'Mapillary 正在限流瓦片请求',
  'Mapillary token not configured': '未配置 Mapillary 令牌',
});

function mapillaryErrorText(error) {
  if (typeof error === 'string' && MAPILLARY_ERROR_TEXT[error])
    return MAPILLARY_ERROR_TEXT[error];
  if (error && typeof error === 'object' && typeof error.message === 'string')
    return MAPILLARY_ERROR_TEXT[error.message] || null;
  return null;
}

/** HTTP error flagged `keyRequired`, `keyRejected` or `retryAfterSec` (429). */
export class MapillarySourceError extends Error {
  constructor(message, { status = 0, payload = null, retryAfterSec } = {}) {
    super(message);
    this.name = 'MapillarySourceError';
    this.status = status;
    this.payload = payload;
    this.keyRequired = payload?.keyRequired ?? payload?.error === 'no_key';
    this.keyRejected = payload?.keyRejected === true;
    const wait = Number(retryAfterSec ?? payload?.retryAfter);
    this.retryAfterSec =
      status === 429 ? (Number.isFinite(wait) && wait > 0 ? wait : 60) : null;
  }
}

async function readJsonOrThrow(response, label) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* status is authoritative */
  }
  if (!response.ok)
    throw new MapillarySourceError(
      mapillaryErrorText(payload?.error) ||
        `${label}请求失败（HTTP ${response.status}）`,
      { status: response.status, payload },
    );
  return payload;
}

/**
 * Mapillary network access: tiles via the local proxy, which adds the token
 * and caches; Graph API lookups direct with the client token, as MapillaryJS.
 * @param {{token?: string, fetchImpl?: Function, endpoints?: object}} options
 */
export function createMapillarySource({
  token = '',
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoints = {},
} = {}) {
  const urls = {
    status: '/api/mapillary/status',
    tiles: '/api/mapillary/tiles',
    graph: MAPILLARY_GRAPH_HOST,
    ...endpoints,
  };

  async function graph(path, params = {}, { signal } = {}) {
    if (!token)
      throw new MapillarySourceError('未配置 Mapillary 令牌', {
        status: 503,
        payload: { keyRequired: true },
      });
    const search = new URLSearchParams({ access_token: token, ...params });
    const response = await fetchImpl(`${urls.graph}/${path}?${search}`, {
      signal,
    });
    return readJsonOrThrow(response, 'Mapillary 图数据');
  }

  return {
    get token() {
      return token;
    },
    hasToken: () => Boolean(token),

    async getStatus({ signal } = {}) {
      const response = await fetchImpl(urls.status, {
        signal,
        cache: 'no-store',
      });
      return readJsonOrThrow(response, 'Mapillary 状态');
    },

    /** Raw protobuf bytes for one tile; an empty array means no data. */
    async getTile(layer, z, x, y, { signal } = {}) {
      const response = await fetchImpl(
        `${urls.tiles}/${layer}/${z}/${x}/${y}`,
        {
          signal,
        },
      );
      if (response.status === 204) return new Uint8Array(0);
      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          /* ignore */
        }
        throw new MapillarySourceError(
          mapillaryErrorText(payload?.error) ||
            `瓦片请求失败（HTTP ${response.status}）`,
          {
            status: response.status,
            payload,
            retryAfterSec: response.headers?.get?.('retry-after') ?? undefined,
          },
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async getSequenceImages(
      sequenceId,
      { signal, limit = SEQUENCE_IMAGES_LIMIT } = {},
    ) {
      const payload = await graph(
        'images',
        {
          sequence_ids: String(sequenceId),
          fields: SEQUENCE_IMAGE_FIELDS,
          limit: String(limit),
        },
        { signal },
      );
      return Array.isArray(payload?.data) ? payload.data : [];
    },

    async nearestImages(
      { lat, lon, radius = NEAREST_RADIUS_M, limit = NEAREST_LIMIT },
      { signal } = {},
    ) {
      const payload = await graph(
        'images',
        {
          lat: String(lat),
          lng: String(lon),
          radius: String(Math.min(50, Math.max(1, radius))),
          limit: String(Math.min(100, Math.max(1, limit))),
          fields: IMAGE_FIELDS,
        },
        { signal },
      );
      return Array.isArray(payload?.data) ? payload.data : [];
    },
  };
}
