/**
 * Tianditu (天地图, National Platform for Common GeoSpatial Information
 * Services) WMTS layers in the Web Mercator ("_w") tile matrix set. The
 * browser requests same-origin `/api/tianditu/{layer}/{z}/{x}/{y}`; the server
 * adds the token, so it never reaches the client bundle.
 */

export const TIANDITU_LAYERS = Object.freeze({
  img: Object.freeze({ maxLevel: 18, label: '影像底图' }),
  cia: Object.freeze({ maxLevel: 18, label: '影像注记' }),
  vec: Object.freeze({ maxLevel: 18, label: '矢量底图' }),
  cva: Object.freeze({ maxLevel: 18, label: '矢量注记' }),
  ter: Object.freeze({ maxLevel: 14, label: '地形晕渲' }),
  cta: Object.freeze({ maxLevel: 14, label: '地形注记' }),
  ibo: Object.freeze({ maxLevel: 10, label: '全球境界' }),
});

export const TIANDITU_ATTRIBUTION =
  '<a href="https://www.tianditu.gov.cn" target="_blank" rel="noopener">© 天地图 · 国家地理信息公共服务平台</a>';

export function isTiandituLayer(layer) {
  return Object.hasOwn(TIANDITU_LAYERS, layer);
}

export function isValidTiandituTile(layer, z, x, y) {
  if (!isTiandituLayer(layer)) return false;
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 1 || z > TIANDITU_LAYERS[layer].maxLevel) return false;
  const size = 2 ** z;
  return x >= 0 && y >= 0 && x < size && y < size;
}

/** Spread requests over the eight published subdomains, stable per tile. */
export function tiandituSubdomain(x, y) {
  return (x + y) % 8;
}

export function tiandituUpstreamUrl(layer, z, x, y, token) {
  const url = new URL(
    `https://t${tiandituSubdomain(x, y)}.tianditu.gov.cn/${layer}_w/wmts`,
  );
  url.search = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer,
    STYLE: 'default',
    TILEMATRIXSET: 'w',
    FORMAT: 'tiles',
    TILEMATRIX: String(z),
    TILEROW: String(y),
    TILECOL: String(x),
    tk: token,
  }).toString();
  return url.href;
}

export function tiandituTileTemplate(layer) {
  return `/api/tianditu/${layer}/{z}/{x}/{y}`;
}
