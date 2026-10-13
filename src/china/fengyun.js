/**
 * 风云四号 B 星 (FY-4B) AGRI full-disk imagery, reprojected from the
 * geostationary view to an equirectangular tile Cesium can drape.
 *
 * Grid constants follow the CGMS LRIT/HRIT normalized geostationary
 * projection used by AGRI. The 1 km disk (10992 px) is decoded at 1/4 scale,
 * which is exactly the 4 km grid.
 */

export const FY4B_SUB_LONGITUDE = 105;
export const FY4B_GRID_4KM = Object.freeze({
  size: 2748,
  cfac: 10233137,
  lfac: 10233137,
  coff: 1373.5,
  loff: 1373.5,
});
export const FENGYUN_HALF_SPAN = 75;
/** Great-circle distance from the sub-satellite point where pixels smear. */
const LIMB_FADE_START_DEG = 65;
const LIMB_CUTOFF_DEG = 72;
export const FENGYUN_ATTRIBUTION =
  '风云四号B星 AGRI 真彩色 · 国家卫星气象中心 (NSMC)';

const H = 42164;
const REQ = 6378.137;
const RPOL = 6356.7523;
const E2 = 1 - (RPOL * RPOL) / (REQ * REQ);
const RATIO2 = (REQ * REQ) / (RPOL * RPOL);
const DEG = Math.PI / 180;

/** Extent of the reprojected image, in degrees. */
export function fengyunRectangle(subLon = FY4B_SUB_LONGITUDE) {
  return {
    west: subLon - FENGYUN_HALF_SPAN,
    south: -FENGYUN_HALF_SPAN,
    east: subLon + FENGYUN_HALF_SPAN,
    north: FENGYUN_HALF_SPAN,
  };
}

/** Column/line on the geostationary grid for a lat/lon, or null when the
 * point is on the far side of the Earth. */
export function geosPixel(
  lat,
  lon,
  subLon = FY4B_SUB_LONGITUDE,
  grid = FY4B_GRID_4KM,
) {
  const phi = Math.atan(Math.tan(lat * DEG) / RATIO2);
  const dl = (lon - subLon) * DEG;
  const cosPhi = Math.cos(phi);
  const rl = RPOL / Math.sqrt(1 - E2 * cosPhi * cosPhi);
  const r1 = H - rl * cosPhi * Math.cos(dl);
  const r2 = -rl * cosPhi * Math.sin(dl);
  const r3 = rl * Math.sin(phi);
  if (H * (H - r1) < r2 * r2 + RATIO2 * r3 * r3) return null;
  const rn = Math.sqrt(r1 * r1 + r2 * r2 + r3 * r3);
  const x = Math.atan(-r2 / r1) / DEG;
  const y = Math.asin(-r3 / rn) / DEG;
  return {
    column: grid.coff + (x * grid.cfac) / 65536 - 0.5,
    line: grid.loff + (y * grid.lfac) / 65536 - 0.5,
  };
}

/**
 * Resample an RGB disk (row-major, `channels` bytes per pixel) into an RGBA
 * equirectangular image over `fengyunRectangle(subLon)`. Off-disk and limb
 * pixels are transparent.
 */
export function reprojectDisk(
  rgb,
  { width, height, channels = 3 },
  {
    outWidth = 2048,
    outHeight = 2048,
    subLon = FY4B_SUB_LONGITUDE,
    grid = FY4B_GRID_4KM,
  } = {},
) {
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const rect = fengyunRectangle(subLon);
  const dLon = (rect.east - rect.west) / outWidth;
  const dLat = (rect.north - rect.south) / outHeight;
  const fadeStart = Math.cos(LIMB_FADE_START_DEG * DEG);
  const fadeEnd = Math.cos(LIMB_CUTOFF_DEG * DEG);
  for (let row = 0; row < outHeight; row++) {
    const lat = rect.north - (row + 0.5) * dLat;
    const cosLat = Math.cos(lat * DEG);
    for (let col = 0; col < outWidth; col++) {
      const lon = rect.west + (col + 0.5) * dLon;
      const cosArc = cosLat * Math.cos((lon - subLon) * DEG);
      if (cosArc <= fadeEnd) continue;
      const p = geosPixel(lat, lon, subLon, grid);
      if (!p) continue;
      const x = Math.round(p.column);
      const y = Math.round(p.line);
      if (x < 0 || y < 0 || x >= width || y >= height || y >= grid.size)
        continue;
      const src = (y * width + x) * channels;
      const dst = (row * outWidth + col) * 4;
      const r = rgb[src];
      const g = rgb[src + 1];
      const b = rgb[src + 2];
      out[dst] = r;
      out[dst + 1] = g;
      out[dst + 2] = b;
      const fade =
        cosArc >= fadeStart ? 1 : (cosArc - fadeEnd) / (fadeStart - fadeEnd);
      out[dst + 3] = r + g + b < 12 ? 0 : Math.round(255 * fade);
    }
  }
  return out;
}

/** "UTC 20261013080000" stamps are not in the JPEG; Last-Modified is. */
export function fengyunObservedAt(lastModified) {
  const ms = Date.parse(lastModified || '');
  return Number.isFinite(ms) ? ms : null;
}
