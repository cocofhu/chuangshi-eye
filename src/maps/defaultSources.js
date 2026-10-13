import { MAP_STACKS } from './catalog.js';
import { photorealUnavailableReason } from './availability.js';
import { keySetupRequirement } from '../keySetupCore.mjs';
import {
  createOsmImagery,
  createEsriImagery,
  createIonImagery,
  createTiandituImagery,
  createAmapImagery,
  ESRI_ATTRIBUTION_HTML,
  TIANDITU_ATTRIBUTION,
  AMAP_TILE_ATTRIBUTION,
} from './imagery.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';

/** Select sources and setup guidance without putting provider branches in the controller. */
export function createDefaultMapSources({
  googleTileset = null,
  cesiumToken = '',
  googleApiKey = '',
  tiandituEnabled = false,
} = {}) {
  const ionToken = String(cesiumToken || '').trim();
  const hasIon = Boolean(ionToken);
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const hasTianditu = tiandituEnabled === true;
  const terrain = {
    id: hasIon ? 'world' : 'keyless',
    create: hasIon
      ? (request) => createWorldTerrain(ionToken, request)
      : createKeylessTerrain,
  };
  const keylessDefault = hasTianditu ? 'tdt-imagery' : 'amap-satellite';
  return {
    defaultId: googleTileset ? 'photoreal' : keylessDefault,
    unknownId: 'photoreal',
    recoveryId: googleTileset ? 'photoreal' : null,
    state: { hasCesiumIonToken: hasIon, hasTiandituToken: hasTianditu },
    sources: MAP_STACKS.map((descriptor) => {
      const common = {
        descriptor,
        available: !descriptor.requiresIon || hasIon,
        unavailableReason: descriptor.requiresIon
          ? keySetupRequirement('cesium-ion')
          : null,
      };
      if (descriptor.kind === 'photoreal')
        return {
          ...common,
          available: Boolean(googleTileset),
          unavailableReason: photorealUnavailableReason(hasIon || hasGoogle),
          tileset: googleTileset,
        };
      if (descriptor.kind === 'tianditu')
        return {
          ...common,
          available: hasTianditu,
          unavailableReason: hasTianditu
            ? null
            : keySetupRequirement('tianditu'),
          imagery: () => createTiandituImagery(descriptor.layer),
          overlayImagery: descriptor.overlay
            ? () => createTiandituImagery(descriptor.overlay)
            : null,
          terrain,
          credit: TIANDITU_ATTRIBUTION,
          constructionFallback: {
            id: 'esri-imagery',
            message: '天地图不可用，已切换到 Esri 卫星影像',
          },
          tileFailureFallback: {
            id: 'esri-imagery',
            threshold: 4,
            message: '天地图瓦片请求失败，已切换到 Esri 卫星影像',
          },
        };
      if (descriptor.kind === 'amap-satellite')
        return {
          ...common,
          imagery: createEsriImagery,
          overlayImagery: () => createAmapImagery('anno'),
          terrain,
          credit: `${ESRI_ATTRIBUTION_HTML} · ${AMAP_TILE_ATTRIBUTION}`,
          constructionFallback: {
            id: 'osm',
            message: '卫星影像不可用，已切换到 OSM',
          },
          tileFailureFallback: {
            id: 'osm',
            threshold: 2,
            message: '卫星影像瓦片请求失败，已切换到 OSM',
          },
        };
      if (descriptor.kind === 'amap-vector')
        return {
          ...common,
          imagery: () => createAmapImagery('vector'),
          terrain,
          credit: AMAP_TILE_ATTRIBUTION,
          constructionFallback: {
            id: 'esri-imagery',
            message: '高德矢量不可用，已切换到 Esri 卫星影像',
          },
          tileFailureFallback: {
            id: 'esri-imagery',
            threshold: 4,
            message: '高德矢量瓦片请求失败，已切换到 Esri 卫星影像',
          },
        };
      const imagery =
        descriptor.kind === 'ion'
          ? () => createIonImagery(descriptor.style, ionToken)
          : descriptor.id === 'osm'
            ? createOsmImagery
            : createEsriImagery;
      return {
        ...common,
        imagery,
        terrain,
        ...(descriptor.id === 'esri-imagery'
          ? {
              credit: ESRI_ATTRIBUTION_HTML,
              constructionFallback: {
                id: 'osm',
                message: 'Esri 卫星影像不可用，已切换到 OSM',
              },
              tileFailureFallback: {
                id: 'osm',
                threshold: 2,
                message: 'Esri 卫星影像瓦片请求失败，已切换到 OSM',
              },
            }
          : {}),
      };
    }),
  };
}
