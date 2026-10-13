import * as Cesium from 'cesium';
import {
  TIANDITU_ATTRIBUTION,
  TIANDITU_LAYERS,
  tiandituTileTemplate,
} from '../china/tianditu.js';
import {
  AMAP_TILE_ATTRIBUTION,
  AMAP_TILE_MAX_LEVEL,
} from '../china/amapTiles.js';
import { Gcj02TilingScheme } from '../china/gcj02TilingScheme.js';

/** Tianditu Web Mercator tiles through the same-origin token proxy. */
export function createTiandituImagery(layer) {
  const spec = TIANDITU_LAYERS[layer];
  if (!spec) throw new Error(`Unknown Tianditu layer: ${layer}`);
  return new Cesium.UrlTemplateImageryProvider({
    url: tiandituTileTemplate(layer),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    minimumLevel: 1,
    maximumLevel: spec.maxLevel,
    credit: '© 天地图 · 国家地理信息公共服务平台',
  });
}

export { TIANDITU_ATTRIBUTION, AMAP_TILE_ATTRIBUTION };

/** Chinese labels or the road map, through the same-origin Amap tile proxy. */
export function createAmapImagery(style) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `/api/amap-tiles/${style}/{z}/{x}/{y}`,
    tilingScheme: new Gcj02TilingScheme(),
    minimumLevel: 1,
    maximumLevel: AMAP_TILE_MAX_LEVEL,
    credit: '© 高德',
  });
}

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}
