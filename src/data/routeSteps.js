/**
 * @module routeSteps
 * @description Turn-by-turn steps from an OSRM route, in Simplified Chinese.
 *
 * OSRM (the FOSSGIS servers behind `/api/route`) returns each step as a
 * maneuver `type` + `modifier` (+ roundabout `exit`) and the road name; it
 * does not phrase instructions. This module does, in Simplified Chinese.
 * Pure: used by the Vite proxy and node:test.
 *
 * OSRM maneuver types handled: depart, arrive, turn, new name, continue,
 * end of road, fork, merge, on ramp, off ramp, roundabout, rotary,
 * roundabout turn, exit roundabout, exit rotary, notification, use lane.
 */

/** Cap on steps returned for one route — a 2,500 km drive rarely needs more. */
export const ROUTE_STEPS_MAX = 200;

const TURN_WORDS = Object.freeze({
  left: '左转',
  right: '右转',
  'slight left': '稍向左转',
  'slight right': '稍向右转',
  'sharp left': '急左转',
  'sharp right': '急右转',
  straight: '直行',
  uturn: '掉头',
});

const KEEP_WORDS = Object.freeze({
  left: '向左',
  right: '向右',
  'slight left': '稍向左',
  'slight right': '稍向右',
  'sharp left': '急向左',
  'sharp right': '急向右',
  straight: '直行',
  uturn: '掉头',
});

const SIDE_WORDS = Object.freeze({
  left: '左',
  right: '右',
  'slight left': '左',
  'slight right': '右',
  'sharp left': '左',
  'sharp right': '右',
});

function cleanText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text;
}

/**
 * Road label for a step: "Name (Ref)", "Name", "Ref", or "".
 * @param {{name?: string, ref?: string}} step
 * @returns {string}
 */
export function roadLabel(step) {
  const name = cleanText(step?.name);
  const ref = cleanText(step?.ref);
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name || ref;
}

function ontoRoad(step) {
  const road = roadLabel(step);
  return road ? `，进入 ${road}` : '';
}

function wordOf(table, modifier) {
  return table[cleanText(modifier).toLowerCase()] || '';
}

/**
 * One Simplified Chinese sentence for an OSRM step. Maneuver type and
 * modifier stay the OSRM tokens; only the spoken instruction changes.
 * @param {{type?: string, modifier?: string, exit?: number, name?: string, ref?: string}} step
 * @returns {string}
 */
export function instructionFor(step) {
  const type = cleanText(step?.type).toLowerCase();
  const modifier = cleanText(step?.modifier).toLowerCase();
  const turn = wordOf(TURN_WORDS, modifier);
  const keep = wordOf(KEEP_WORDS, modifier);
  const side = wordOf(SIDE_WORDS, modifier);
  const onto = ontoRoad(step);
  const road = roadLabel(step);
  switch (type) {
    case 'depart':
      return road ? `沿 ${road} 出发` : '出发';
    case 'arrive':
      if (modifier === 'left') return '到达目的地，靠左侧';
      if (modifier === 'right') return '到达目的地，靠右侧';
      return '到达目的地';
    case 'turn':
      if (modifier === 'uturn') return `掉头${onto}`;
      if (modifier === 'straight') return `继续直行${onto}`;
      return turn ? `${turn}${onto}` : `转弯${onto}`;
    case 'new name':
      return `继续${onto}`;
    case 'continue':
      if (modifier === 'uturn') return `掉头${onto}`;
      return turn && turn !== '直行'
        ? `继续${turn}${onto}`
        : `继续直行${onto}`;
    case 'end of road':
      return turn ? `路尽头${turn}${onto}` : `路尽头继续${onto}`;
    case 'fork':
      return keep ? `岔路${keep}${onto}` : `岔路继续${onto}`;
    case 'merge':
      return keep ? `${keep}汇入${onto}` : `汇入${onto}`;
    case 'on ramp':
      return side ? `从${side}侧进入匝道${onto}` : `进入匝道${onto}`;
    case 'off ramp':
      return side ? `从${side}侧驶出${onto}` : `驶出${onto}`;
    case 'roundabout':
    case 'rotary': {
      const exit =
        Number.isInteger(step?.exit) && step.exit >= 1 ? step.exit : null;
      return exit ? `环岛走第 ${exit} 出口${onto}` : `进入环岛${onto}`;
    }
    case 'roundabout turn':
      return turn ? `环岛${turn}${onto}` : `环岛继续${onto}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `驶出环岛${onto}`;
    case 'use lane':
      return side ? `使用${side}侧车道${onto}` : `继续${onto}`;
    case 'notification':
    default:
      return `继续${onto}`;
  }
}

/**
 * Flatten an OSRM route's legs into the compact step list the proxy serves.
 * "exit roundabout" / "exit rotary" steps are folded into the roundabout
 * step before them (their distance is the road after the roundabout), so a
 * reader gets one instruction per decision.
 * A route with more maneuvers than `ROUTE_STEPS_MAX` is cut off there and
 * reported as cut off, because the last step of a route is its arrival: a
 * silently truncated list reads as a complete set of directions that simply
 * stops in the middle of a motorway.
 * @param {{legs?: Array<{steps?: object[]}>}} route OSRM route object.
 * @returns {{steps: Array<{index:number, type:string, modifier:string|null, exit:number|null,
 *   name:string, ref:string|null, distanceM:number, durationS:number, lon:number, lat:number,
 *   instruction:string}>, truncated: boolean}}
 */
export function normalizeOsrmSteps(route) {
  const out = [];
  for (const leg of route?.legs || []) {
    for (const raw of leg?.steps || []) {
      const location = raw?.maneuver?.location;
      const lon = Number(location?.[0]);
      const lat = Number(location?.[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const type = cleanText(raw.maneuver?.type).toLowerCase() || 'continue';
      const step = {
        index: out.length,
        type,
        modifier: cleanText(raw.maneuver?.modifier).toLowerCase() || null,
        exit: Number.isInteger(raw.maneuver?.exit) ? raw.maneuver.exit : null,
        name: cleanText(raw.name),
        ref: cleanText(raw.ref) || null,
        distanceM: Math.max(0, Math.round(Number(raw.distance) || 0)),
        durationS: Math.max(0, Math.round(Number(raw.duration) || 0)),
        lon: Number(lon.toFixed(6)),
        lat: Number(lat.toFixed(6)),
        instruction: '',
      };
      const previous = out[out.length - 1];
      if (
        (type === 'exit roundabout' || type === 'exit rotary') &&
        previous &&
        (previous.type === 'roundabout' ||
          previous.type === 'rotary' ||
          previous.type === 'roundabout turn')
      ) {
        previous.distanceM += step.distanceM;
        previous.durationS += step.durationS;
        if (!roadLabel(previous) && roadLabel(step)) {
          previous.name = step.name;
          previous.ref = step.ref;
          previous.instruction = instructionFor(previous);
        }
        continue;
      }
      step.instruction = instructionFor(step);
      out.push(step);
      if (out.length >= ROUTE_STEPS_MAX) return { steps: out, truncated: true };
    }
  }
  return { steps: out, truncated: false };
}

/**
 * "850 m", "1.2 km", "21 km".
 * @param {number} meters
 * @returns {string}
 */
export function formatRouteDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 100) return `${Math.round(meters)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * "40 s", "12 min", "1 h 5 min".
 * @param {number} seconds
 * @returns {string}
 */
export function formatRouteDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
