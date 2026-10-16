/** Space queries: launches, satellite passes and satellites overhead. */

import { suggestView } from '../views.js';
import { twoline2satrec } from 'satellite.js';
import {
  findNextSatellitePass,
  lookAnglesAt,
} from '../../data/satellitePass.js';
import { parseTleText, tleCatalogNumber } from '../../sources/tle.js';
import { POINT_SCHEMA, resolvePoint } from '../area.js';
import { defineTool, ToolError } from '../catalog.js';
import { LIMIT_SCHEMA, capRows, isoTime } from '../results.js';

const text = (value) => (typeof value === 'string' && value ? value : null);

export const getRecentLaunches = defineTool({
  name: 'get_recent_launches',
  title: 'Recent launches',
  description:
    'Orbital launches from Launch Library 2 over the last 30 days, newest ' +
    'first, with provider, rocket, pad, mission and outcome.',
  inputSchema: {
    type: 'object',
    properties: { limit: LIMIT_SCHEMA },
    additionalProperties: false,
  },
  requires: ['launches'],
  async run(args, { services, signal }) {
    const { payload, stale } = services.launches.getLaunchSnapshot
      ? await services.launches.getLaunchSnapshot({ signal })
      : {
          payload: await services.launches.getLaunches({ signal }),
          stale: false,
        };
    const launches = Array.isArray(payload) ? payload : payload.results;
    if (!Array.isArray(launches))
      throw new ToolError('malformed', '发射数据源没有返回发射任务');
    const rows = launches
      .map((launch) => ({
        id: text(launch?.id),
        name: text(launch?.name),
        time: text(launch?.net),
        status: text(launch?.status?.name),
        provider: text(launch?.launch_service_provider?.name),
        rocket: text(
          launch?.rocket?.configuration?.full_name ??
            launch?.rocket?.configuration?.name,
        ),
        pad: text(launch?.pad?.name),
        location: text(launch?.pad?.location?.name),
        mission: text(launch?.mission?.name),
        orbit: text(launch?.mission?.orbit?.name),
      }))
      .filter((launch) => launch.name)
      .sort((a, b) => String(b.time).localeCompare(String(a.time)));
    const result = capRows(rows, args.limit);
    return {
      summary:
        `${rows.length} 次发射，近 30 天${rows[0] ? `；最近 ${rows[0].name}` : ''}` +
        (stale ? '（数据可能已过期）。' : '。'),
      data: {
        view: suggestView(services, {
          point: { lat: 20, lon: 0 },
          altitudeM: 15_000_000,
          layers: ['rocket-launches'],
        }),
        ...result,
        stale,
      },
    };
  },
});

// Groups served by the satellite catalog route; `stations` includes the ISS.
const GROUPS = [
  'stations',
  'beidou',
  'visual',
  'gps-ops',
  'glo-ops',
  'galileo',
  'geo',
  'starlink',
];
const ISS_NORAD = 25544;
const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
const GROUP_SCHEMA = {
  type: 'string',
  enum: GROUPS,
  description: 'CelesTrak group to search (default "stations").',
};

const compass = (degrees) =>
  COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
const round = (value, digits) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const nowMs = (services) => services.clock?.now() ?? Date.now();

/** A view following a satellite from above an observer. */
function followSatellite(services, point, satellite) {
  return satellite.norad
    ? suggestView(services, {
        point,
        altitudeM: 3_000_000,
        follow: { kind: 'satellite', id: String(satellite.norad) },
      })
    : null;
}

async function readCatalog(services, group, signal) {
  const result = await services.satellites.readGroup(group, { signal });
  if (!result.ok)
    throw new ToolError(
      'unavailable',
      `${group} 卫星星表不可用（HTTP ${result.status}）`,
    );
  const entries = parseTleText(result.text).flatMap((entry) => {
    try {
      return [
        {
          ...entry,
          norad: tleCatalogNumber(entry.line1),
          satrec: twoline2satrec(entry.line1, entry.line2),
        },
      ];
    } catch {
      return [];
    }
  });
  // The proxy serves its last copy when CelesTrak is down; old orbital
  // elements make predictions drift.
  return { entries, stale: result.stale === true };
}

function matchSatellite(entries, wanted) {
  if (wanted == null)
    return entries.find((entry) => entry.norad === ISS_NORAD) ?? null;
  const text = String(wanted).trim().toUpperCase();
  const number = /^\d+$/.test(text) ? Number(text) : null;
  return (
    entries.find((entry) => number != null && entry.norad === number) ??
    entries.find((entry) => entry.name.toUpperCase() === text) ??
    entries.find((entry) => entry.name.toUpperCase().includes(text)) ??
    null
  );
}

export const nextSatellitePass = defineTool({
  name: 'next_satellite_pass',
  title: 'Next satellite pass',
  description:
    'When a satellite next rises over an observer, with rise, peak and set ' +
    'times, peak elevation, rise direction and naked-eye visibility. Defaults ' +
    'to the International Space Station.',
  inputSchema: {
    type: 'object',
    properties: {
      location: POINT_SCHEMA,
      satellite: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description:
          'Satellite name or NORAD catalog number (default the ISS).',
      },
      group: GROUP_SCHEMA,
      min_elevation_deg: { type: 'number', minimum: 0, maximum: 80 },
      visible_only: {
        type: 'boolean',
        description: 'Only passes visible to the naked eye.',
      },
      hours: { type: 'number', minimum: 1, maximum: 72 },
    },
    required: ['location'],
    additionalProperties: false,
  },
  requires: ['satellites'],
  async run(args, { services, signal }) {
    const point = await resolvePoint(args.location, { services, signal });
    const group = args.group ?? 'stations';
    const { entries, stale } = await readCatalog(services, group, signal);
    const staleNote = stale ? '（轨道数据可能已过期）' : '';
    const satellite = matchSatellite(entries, args.satellite);
    if (!satellite)
      throw new ToolError(
        'invalid_arguments',
        `「${args.satellite ?? 'ISS'}」不在 ${group} 组中`,
      );
    const hours = args.hours ?? 24;
    const pass = findNextSatellitePass({
      satrec: satellite.satrec,
      latDeg: point.lat,
      lonDeg: point.lon,
      fromMs: nowMs(services),
      minElevDeg: args.min_elevation_deg ?? 10,
      horizonHours: hours,
      requireVisible: args.visible_only === true,
    });
    const name = satellite.name;
    if (!pass)
      return {
        summary: `${name} 在未来 ${hours} 小时内于 ${point.label} 无${args.visible_only ? '可见' : ''}过境${staleNote}。`,
        data: {
          view: followSatellite(services, point, satellite),
          stale,
          location: point,
          satellite: name,
          norad: satellite.norad,
          pass: null,
        },
      };
    return {
      summary:
        `${name} 下次于 ${isoTime(pass.riseMs)} 在 ${point.label} 升起，方向 ${compass(pass.riseAzDeg)}，最高 ${Math.round(pass.maxElevDeg)}°` +
        `${pass.visible ? '；肉眼可见' : ''}${staleNote}。`,
      data: {
        view: followSatellite(services, point, satellite),
        stale,
        location: point,
        satellite: name,
        norad: satellite.norad,
        pass: {
          rise: isoTime(pass.riseMs),
          peak: isoTime(pass.maxElevMs),
          set: isoTime(pass.setMs),
          max_elevation_deg: round(pass.maxElevDeg, 1),
          rise_azimuth_deg: round(pass.riseAzDeg, 0),
          rise_direction: compass(pass.riseAzDeg),
          visible: pass.visible,
        },
      },
    };
  },
});

export const satellitesOverhead = defineTool({
  name: 'satellites_overhead',
  title: 'Satellites overhead',
  description:
    'Satellites in a group that are above an observer right now, highest first, ' +
    'with elevation and direction.',
  inputSchema: {
    type: 'object',
    properties: {
      location: POINT_SCHEMA,
      group: GROUP_SCHEMA,
      min_elevation_deg: { type: 'number', minimum: 0, maximum: 90 },
      limit: LIMIT_SCHEMA,
    },
    required: ['location'],
    additionalProperties: false,
  },
  requires: ['satellites'],
  async run(args, { services, signal }) {
    const point = await resolvePoint(args.location, { services, signal });
    const group = args.group ?? 'stations';
    const minimum = args.min_elevation_deg ?? 10;
    const at = nowMs(services);
    const { entries, stale } = await readCatalog(services, group, signal);
    const rows = entries
      .flatMap((entry) => {
        const look = lookAnglesAt(entry.satrec, at, point.lat, point.lon);
        return look && look.elevDeg >= minimum
          ? [
              {
                name: entry.name,
                norad: entry.norad,
                elevation_deg: round(look.elevDeg, 1),
                azimuth_deg: round(look.azDeg, 0),
                direction: compass(look.azDeg),
              },
            ]
          : [];
      })
      .sort((a, b) => b.elevation_deg - a.elevation_deg);
    return {
      summary:
        `${rows.length} 颗 ${group} 组卫星在 ${isoTime(at)} 时位于 ${point.label} 上空至少 ${minimum}°` +
        (stale ? '（轨道数据可能已过期）。' : '。'),
      data: {
        view: suggestView(services, {
          point,
          altitudeM: 3_000_000,
          layers: ['satellites'],
        }),
        ...capRows(rows, args.limit),
        stale,
        location: point,
        group,
        at: isoTime(at),
      },
    };
  },
});
