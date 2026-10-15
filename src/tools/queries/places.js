/** Place search and routing queries. */

import { defineTool, ToolError } from '../catalog.js';
import {
  AREA_SCHEMA,
  POINT_SCHEMA,
  areaCenter,
  areaContains,
  areaRadiusKm,
  resolveArea,
  resolvePoint,
} from '../area.js';
import { LIMIT_SCHEMA, capRows, thinEvenly } from '../results.js';

// Most results the app's place search endpoints return, and the widest
// radius a text search covers.
const SEARCH_RESULTS = 5;
const NEARBY_RESULTS = 20;
const MAX_SEARCH_RADIUS_M = 50_000;

const MODES = { walk: 'foot', drive: 'car', bike: 'bike' };
const MODE_WORDS = { walk: '步行', drive: '驾车', bike: '骑行' };
const MAX_ROUTE_POINTS = 100;
const NOT_CONFIGURED =
  'Place search needs a Google Places key configured for this server';

const round = (value, digits) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function placeRow(place) {
  return {
    id: place.id ?? null,
    name: place.name ?? null,
    address: place.address ?? null,
    type: place.primaryType ?? null,
    lat: round(place.latitude, 6),
    lon: round(place.longitude, 6),
    distance_m: Number.isFinite(place.distanceM) ? place.distanceM : null,
  };
}

export const searchPlaces = defineTool({
  name: 'search_places',
  title: 'Search places',
  description:
    'Find businesses, landmarks and other points of interest matching a ' +
    'query within an area, using Google Places.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      area: AREA_SCHEMA,
      limit: LIMIT_SCHEMA,
    },
    required: ['query', 'area'],
    additionalProperties: false,
  },
  requires: ['placeSearch'],
  async run(args, { services, signal }) {
    const area = await resolveArea(args.area, { services, signal });
    const center = areaCenter(area);
    const wantedM = areaRadiusKm(area) * 1000;
    const radiusM = Math.round(
      Math.min(MAX_SEARCH_RADIUS_M, Math.max(500, wantedM)),
    );
    const result = await services.placeSearch.search(
      args.query,
      { latitude: center.lat, longitude: center.lon, radiusM },
      { signal },
    );
    if (!result.configured) throw new ToolError('unavailable', NOT_CONFIGURED);
    const rows = result.places
      .filter((place) =>
        areaContains(area, { lat: place.latitude, lon: place.longitude }),
      )
      .map(placeRow);
    // The search returns a few matches within a capped radius; say so when
    // either limit may have left places out.
    const limited = result.places.length >= SEARCH_RESULTS;
    const narrowed = wantedM > MAX_SEARCH_RADIUS_M;
    const notes = [
      ...(limited ? [`搜索最多返回 ${SEARCH_RESULTS} 条`] : []),
      ...(narrowed
        ? [`仅搜索中心周边 ${MAX_SEARCH_RADIUS_M / 1000} km`]
        : []),
    ];
    return {
      summary:
        `${rows.length} 个地点匹配「${args.query}」，位于 ${area.label}` +
        (notes.length ? `（${notes.join('；')}）。` : '。'),
      data: {
        ...capRows(rows, args.limit),
        may_have_more: limited || narrowed,
        searched_radius_km: radiusM / 1000,
      },
    };
  },
});

export const placesNearby = defineTool({
  name: 'places_nearby',
  title: 'Places nearby',
  description:
    'Notable places around a point within a radius, most notable first, ' +
    'using Google Places.',
  inputSchema: {
    type: 'object',
    properties: {
      location: POINT_SCHEMA,
      radius_m: { type: 'number', minimum: 10, maximum: 5000 },
      limit: LIMIT_SCHEMA,
    },
    required: ['location'],
    additionalProperties: false,
  },
  requires: ['placeSearch'],
  async run(args, { services, signal }) {
    const point = await resolvePoint(args.location, { services, signal });
    const radiusM = Math.round(args.radius_m ?? 250);
    const result = await services.placeSearch.nearby(
      { latitude: point.lat, longitude: point.lon, radiusM },
      { signal },
    );
    if (!result.configured) throw new ToolError('unavailable', NOT_CONFIGURED);
    const rows = result.places.map(placeRow);
    const limited = result.places.length >= NEARBY_RESULTS;
    return {
      summary:
        `${rows.length} 个地点，距 ${point.label} ${radiusM} 米内` +
        (limited
          ? `（附近搜索最多返回 ${NEARBY_RESULTS} 个地点）。`
          : '。'),
      data: { ...capRows(rows, args.limit), may_have_more: limited },
    };
  },
});

export const planRoute = defineTool({
  name: 'plan_route',
  title: 'Plan a route',
  description:
    'Walking, driving or cycling route between two locations over ' +
    'OpenStreetMap, with distance, duration and a simplified path.',
  inputSchema: {
    type: 'object',
    properties: {
      from: POINT_SCHEMA,
      to: POINT_SCHEMA,
      mode: { type: 'string', enum: Object.keys(MODES) },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  requires: ['routing'],
  async run(args, { services, signal }) {
    const [from, to] = await Promise.all([
      resolvePoint(args.from, { services, signal }),
      resolvePoint(args.to, { services, signal }),
    ]);
    const mode = args.mode ?? 'walk';
    const modeWord = MODE_WORDS[mode] || mode;
    const route = await services.routing.route([from, to], MODES[mode], {
      signal,
    });
    if (!route?.ok)
      throw new ToolError(
        'invalid_arguments',
        `没有从 ${from.label} 到 ${to.label} 的${modeWord}路线：${route?.error || '未找到路线'}`,
      );
    const path = thinEvenly(route.geometry, MAX_ROUTE_POINTS).map(
      ([lon, lat]) => [round(lon, 5), round(lat, 5)],
    );
    const km = route.distanceM / 1000;
    const minutes = Math.round(route.durationS / 60);
    return {
      summary: `${modeWord}，从 ${from.label} 到 ${to.label}：${km.toFixed(1)} km，约 ${minutes} 分钟。`,
      data: {
        mode,
        from,
        to,
        distance_m: route.distanceM,
        duration_s: route.durationS,
        path_lon_lat: path,
        path_points: route.geometry.length,
      },
    };
  },
});
