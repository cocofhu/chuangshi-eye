import { PACK_LIMITS } from './manifest.js';

/** Decode a bounded geometry-only GeoJSON collection; properties never become HTML, styles or URLs. */
export function decodePackGeoJSON(bytes) {
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (
    value?.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    value.features.length > PACK_LIMITS.features
  )
    throw new Error('需要有界的 FeatureCollection');
  let positions = 0;
  const ids = new Set();
  function position(p) {
    if (
      !Array.isArray(p) ||
      ![2, 3].includes(p.length) ||
      p.some((v) => !Number.isFinite(v)) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90 ||
      (p.length === 3 && (p[2] < -12000 || p[2] > 1e9)) ||
      ++positions > PACK_LIMITS.positions
    )
      throw new Error('地理坐标无效');
    return [p[0], p[1], p[2] ?? 0];
  }
  function line(points, ring = false) {
    if (!Array.isArray(points) || points.length < (ring ? 4 : 2))
      throw new Error('线段无效');
    const normalized = points.map(position);
    if (ring && normalized[0].some((v, i) => v !== normalized.at(-1)[i]))
      throw new Error('环未闭合');
    return normalized;
  }
  return value.features.map((feature) => {
    const id = feature?.id;
    if (
      feature?.type !== 'Feature' ||
      typeof id !== 'string' ||
      !id.trim() ||
      id.length > 256 ||
      ids.has(id)
    )
      throw new Error('要素需要互不相同的字符串 ID');
    ids.add(id);
    const g = feature.geometry;
    let coordinates;
    if (g?.type === 'Point') coordinates = position(g.coordinates);
    else if (g?.type === 'LineString') coordinates = line(g.coordinates);
    else if (
      g?.type === 'Polygon' &&
      Array.isArray(g.coordinates) &&
      g.coordinates.length &&
      g.coordinates.length <= 128
    )
      coordinates = g.coordinates.map((ring) => line(ring, true));
    else throw new Error('不支持的几何类型');
    return { id, type: g.type, coordinates };
  });
}
