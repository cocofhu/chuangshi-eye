/** Public camera and radio queries over the CCTV and radio sources. */

import { suggestView } from '../views.js';
import { defineTool, ToolError } from '../catalog.js';
import {
  AREA_SCHEMA,
  areaCenter,
  areaContains,
  distanceKm,
  resolveArea,
} from '../area.js';
import { LIMIT_SCHEMA, capRows, toBase64 } from '../results.js';

const FRAME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FRAME_BYTES = 3 * 1024 * 1024;

const round = (value, digits) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const text = (value) => (typeof value === 'string' && value ? value : null);

async function readCatalog(services, signal) {
  const payload = await services.cctv.getCatalog({ signal });
  return {
    cameras: payload.sources.filter(
      (camera) =>
        camera?.id &&
        Number.isFinite(camera.lat) &&
        Number.isFinite(camera.lon),
    ),
    // Regional packs the catalog serves only part of, nearest their centers.
    trimmed: Array.isArray(payload.trimmedPacks) ? payload.trimmedPacks : [],
  };
}

/** Whether an area's box overlaps a plain region box. */
function boxesOverlap(area, region) {
  if (area.south > region.north || area.north < region.south) return false;
  const spans =
    area.west <= area.east
      ? [[area.west, area.east]]
      : [
          [area.west, 180],
          [-180, area.east],
        ];
  return spans.some(
    ([west, east]) => west <= region.east && east >= region.west,
  );
}

async function readCameras(services, signal) {
  return (await readCatalog(services, signal)).cameras;
}

export const findCctvCameras = defineTool({
  name: 'find_cctv_cameras',
  title: 'Public cameras in an area',
  description:
    'Public traffic and city cameras in an area, nearest the center first. ' +
    'Use get_cctv_snapshot with a camera id to see its current view.',
  inputSchema: {
    type: 'object',
    properties: { area: AREA_SCHEMA, limit: LIMIT_SCHEMA },
    required: ['area'],
    additionalProperties: false,
  },
  requires: ['cctv'],
  async run(args, { services, signal }) {
    const area = await resolveArea(args.area, { services, signal });
    const center = areaCenter(area);
    const catalog = await readCatalog(services, signal);
    const found = catalog.cameras.filter((camera) =>
      areaContains(area, camera),
    );
    // A trimmed pack matters wherever its cameras are, served or not, so
    // its region decides, not the cameras returned.
    const packs = new Set(found.map((camera) => camera.pack).filter(Boolean));
    const trimmed = catalog.trimmed.filter((entry) =>
      entry.region ? boxesOverlap(area, entry.region) : packs.has(entry.pack),
    );
    const rows = found
      .map((camera) => ({
        id: camera.id,
        name: text(camera.name),
        city: text(camera.city),
        provider: text(camera.provider),
        lat: round(camera.lat, 6),
        lon: round(camera.lon, 6),
        heading_deg: round(camera.headingDeg, 0),
        feed_type: text(camera.feedType),
        credit: text(camera.credit),
        distance_km: round(distanceKm(center, camera), 2),
      }))
      .sort((a, b) => a.distance_km - b.distance_km);
    return {
      summary:
        (rows.length || trimmed.length
          ? `${rows.length} 个公开摄像头，位于 ${area.label}`
          : // The catalog covers selected regions; an empty answer elsewhere
            // means it has no cameras there, not that none exist.
            `摄像头目录在 ${area.label} 没有摄像头`) +
        (trimmed.length
          ? `（目录仅提供部分摄像头：${trimmed
              .map(
                (entry) =>
                  `${entry.pack} ${entry.served}/${entry.available}`,
              )
              .join('，')}）。`
          : '。'),
      data: {
        view: suggestView(services, { area, layers: ['cctv'] }),
        ...capRows(rows, args.limit),
        complete: trimmed.length === 0,
        catalog_trimmed: trimmed,
      },
    };
  },
});

export const getCctvSnapshot = defineTool({
  name: 'get_cctv_snapshot',
  title: 'Current camera view',
  description:
    'The current image from one public camera, by the id from find_cctv_cameras.',
  inputSchema: {
    type: 'object',
    properties: { camera_id: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['camera_id'],
    additionalProperties: false,
  },
  requires: ['cctv'],
  async run(args, { services, signal }) {
    const camera = (await readCameras(services, signal)).find(
      (candidate) => candidate.id === args.camera_id,
    );
    if (!camera)
      throw new ToolError(
        'invalid_arguments',
        `没有编号为 ${args.camera_id} 的摄像头；请先查找公开摄像头`,
      );
    const frame = await services.cctv.getFrame(camera, { signal });
    if (!FRAME_TYPES.has(frame.contentType))
      throw new ToolError(
        'unavailable',
        `摄像头 ${camera.name || camera.id} 当前没有静止画面`,
      );
    if (frame.bytes.byteLength > MAX_FRAME_BYTES)
      throw new ToolError(
        'unavailable',
        '摄像头图像过大，无法返回',
      );
    const name = text(camera.name) || camera.id;
    return {
      summary: `${name} 的当前画面${camera.city ? `，${camera.city}` : ''}${camera.credit ? `，来源 ${camera.credit}` : ''}。`,
      data: {
        view: suggestView(services, {
          point: { lat: camera.lat, lon: camera.lon },
          altitudeM: 1_500,
          layers: ['cctv'],
        }),
        id: camera.id,
        name,
        city: text(camera.city),
        provider: text(camera.provider),
        credit: text(camera.credit),
        mime_type: frame.contentType,
        bytes: frame.bytes.byteLength,
      },
      images: [{ mimeType: frame.contentType, data: toBase64(frame.bytes) }],
    };
  },
});

export const findRadioStations = defineTool({
  name: 'find_radio_stations',
  title: 'Radio stations',
  description:
    'Internet radio stations from a directory of popular Radio Browser ' +
    'stations, not every station, by area and/or ' +
    'a search term matched against name, tags, language and country. Each ' +
    "result includes the broadcaster's public stream URL.",
  inputSchema: {
    type: 'object',
    properties: {
      area: AREA_SCHEMA,
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description: 'Words such as "jazz", "news" or "Tokyo".',
      },
      limit: LIMIT_SCHEMA,
    },
    additionalProperties: false,
  },
  requires: ['radio'],
  async run(args, { services, signal }) {
    if (!args.area && !args.query)
      throw new ToolError('invalid_arguments', 'Give an area, a query or both');
    const area = args.area
      ? await resolveArea(args.area, { services, signal })
      : null;
    const terms = String(args.query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const directory = await services.radio.getDirectory({ signal });
    if (!Array.isArray(directory?.stations))
      throw new ToolError(
        'malformed',
        '电台目录没有返回电台',
      );
    const center = area ? areaCenter(area) : null;
    const rows = directory.stations
      .filter((station) => !area || areaContains(area, station))
      .filter((station) => {
        if (!terms.length) return true;
        const haystack = [
          station.name,
          ...(station.tags || []),
          ...(station.languages || []),
          station.country,
          station.state,
        ]
          .join(' ')
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .map((station) => ({
        id: station.id,
        name: text(station.name),
        country: text(station.country),
        state: text(station.state),
        tags: station.tags || [],
        languages: station.languages || [],
        codec: text(station.codec),
        bitrate_kbps: Number.isFinite(station.bitrate) ? station.bitrate : null,
        stream_url: text(station.streamUrl),
        homepage: text(station.homepage),
        lat: round(station.lat, 4),
        lon: round(station.lon, 4),
        ...(center
          ? { distance_km: round(distanceKm(center, station), 1) }
          : {}),
      }));
    if (center) rows.sort((a, b) => a.distance_km - b.distance_km);
    const where = area ? `，位于 ${area.label}` : '';
    const what = args.query ? `，匹配「${args.query}」` : '';
    // The directory is a selection of popular stations, not every station.
    const notes = [
      `来自 ${directory.stations.length} 个热门电台的目录`,
      ...(directory.stale ? ['目录可能已过期'] : []),
      ...(directory.degraded ? ['目录当前不完整'] : []),
    ];
    return {
      summary: `${rows.length} 个电台${what}${where}（${notes.join('；')}）。`,
      data: {
        view: area ? suggestView(services, { area, layers: ['radio'] }) : null,
        ...capRows(rows, args.limit),
        directory_size: directory.stations.length,
        stale: directory.stale === true,
        degraded: directory.degraded === true,
      },
    };
  },
});
