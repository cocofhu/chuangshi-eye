/**
 * GCJ-02 ("Mars coordinates") <-> WGS-84 conversion.
 *
 * Amap (高德) and Tencent return GCJ-02. The globe, Tianditu (CGCS2000, which
 * matches WGS-84 to well under a metre) and every other layer are WGS-84, so
 * every Amap coordinate is converted before it is drawn. Outside mainland
 * China GCJ-02 equals WGS-84 and the points pass through unchanged.
 */

const A = 6378245.0;
const EE = 0.006693421622965943;

/** Coarse mainland bounding box used by every published implementation. */
export function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLon(x, y) {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return ret;
}

function offset(lon, lat) {
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [dLon, dLat];
}

/** @returns {[number, number]} GCJ-02 [lon, lat]. */
export function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];
  const [dLon, dLat] = offset(lon, lat);
  return [lon + dLon, lat + dLat];
}

/**
 * Inverse by fixed-point iteration; converges to ~1e-7 degrees (centimetres)
 * in a handful of steps, unlike the one-step approximation's ~1-2 m error.
 * @returns {[number, number]} WGS-84 [lon, lat].
 */
export function gcj02ToWgs84(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];
  let wLon = lon;
  let wLat = lat;
  for (let i = 0; i < 10; i += 1) {
    const [gLon, gLat] = wgs84ToGcj02(wLon, wLat);
    const dLon = gLon - lon;
    const dLat = gLat - lat;
    wLon -= dLon;
    wLat -= dLat;
    if (Math.abs(dLon) < 1e-9 && Math.abs(dLat) < 1e-9) break;
  }
  return [wLon, wLat];
}

/** Parse an Amap "lon,lat" string and convert it to WGS-84, or null. */
export function amapLocationToWgs84(location) {
  if (typeof location !== 'string') return null;
  const parts = location.split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  )
    return null;
  return gcj02ToWgs84(lon, lat);
}

/** Convert an Amap polyline "lon,lat;lon,lat;..." to WGS-84 pairs. */
export function amapPolylineToWgs84(polyline) {
  if (typeof polyline !== 'string' || !polyline) return [];
  const points = [];
  for (const pair of polyline.split(';')) {
    const point = amapLocationToWgs84(pair);
    if (point) points.push(point);
  }
  return points;
}
