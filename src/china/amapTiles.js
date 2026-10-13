/**
 * Keyless Amap raster tiles. `anno` is the transparent Chinese label layer
 * drawn over Esri imagery; `vector` is the road map. Both are GCJ-02, so the
 * imagery provider must use Gcj02TilingScheme. The browser only ever requests
 * the same-origin proxy.
 */

export const AMAP_TILE_STYLES = Object.freeze(['anno', 'vector']);
export const AMAP_TILE_MAX_LEVEL = 18;
export const AMAP_TILE_ATTRIBUTION =
  '<a href="https://lbs.amap.com" target="_blank" rel="noopener">© 高德</a>';

export function isValidAmapTile(style, z, x, y) {
  if (!AMAP_TILE_STYLES.includes(style)) return false;
  if (!Number.isInteger(z) || z < 0 || z > AMAP_TILE_MAX_LEVEL) return false;
  const span = 2 ** z;
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < span &&
    y < span
  );
}

/** Upstream URL for one tile, or null for an unknown style. */
export function amapTileUpstreamUrl(style, z, x, y) {
  const server = ((x + y) % 4) + 1;
  if (style === 'anno') {
    return `https://webst0${server}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`;
  }
  if (style === 'vector') {
    return (
      `https://webrd0${server}.is.autonavi.com/appmaptile?lang=zh_cn` +
      `&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`
    );
  }
  return null;
}
