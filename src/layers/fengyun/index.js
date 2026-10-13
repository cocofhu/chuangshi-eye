import * as Cesium from 'cesium';
import { FENGYUN_ATTRIBUTION } from '../../china/fengyun.js';

const STATUS_URL = '/api/fengyun/status';
const IMAGE_URL = '/api/fengyun/fy4b.webp';

function validStatus(value) {
  const r = value?.rectangle;
  if (
    value?.available !== true ||
    !r ||
    !['west', 'south', 'east', 'north'].every((k) => Number.isFinite(r[k])) ||
    r.west >= r.east ||
    r.south >= r.north
  )
    throw new Error('风云云图状态无效');
  return value;
}

/** 风云四号 B 星全圆盘真彩色，按观测时次替换单张贴图。 */
export function createFengyunLayer({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let viewer = null;
  let imageryLayer = null;
  let shownKey = null;
  let enabled = false;
  let request = null;
  let observedAt = null;
  let lastUpdate = null;
  let lastError = null;

  function remove() {
    if (imageryLayer && viewer?.imageryLayers)
      viewer.imageryLayers.remove(imageryLayer, true);
    imageryLayer = null;
    shownKey = null;
  }

  return {
    id: 'fengyun-cloud',
    name: '风云四号云图',
    icon: '☁',
    source: '国家卫星气象中心 · FY-4B',
    updateInterval: 10 * 60_000,

    init(value) {
      viewer = value;
    },

    enable() {
      enabled = true;
      if (imageryLayer) imageryLayer.show = true;
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      remove();
    },

    async update() {
      if (!enabled || !viewer) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetchImpl(STATUS_URL, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(`风云云图暂不可用 (HTTP ${response.status})`);
        const status = validStatus(await response.json());
        if (controller.signal.aborted || !enabled) return false;
        const key = String(status.observedAt ?? status.renderedAt);
        if (key !== shownKey) {
          const r = status.rectangle;
          const provider = await Cesium.SingleTileImageryProvider.fromUrl(
            `${IMAGE_URL}?t=${encodeURIComponent(key)}`,
            {
              rectangle: Cesium.Rectangle.fromDegrees(
                r.west,
                r.south,
                r.east,
                r.north,
              ),
              credit: new Cesium.Credit(FENGYUN_ATTRIBUTION),
            },
          );
          if (controller.signal.aborted || !enabled) return false;
          const next = viewer.imageryLayers.addImageryProvider(provider);
          next.alpha = 0.8;
          remove();
          imageryLayer = next;
          shownKey = key;
        }
        observedAt = status.observedAt ?? null;
        lastUpdate = Date.now();
        lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        lastError = error?.message || '风云云图暂不可用';
        return false;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy() {
      enabled = false;
      request?.abort();
      request = null;
      remove();
      viewer = null;
    },

    getStats() {
      return {
        count: imageryLayer ? 1 : 0,
        lastUpdate,
        observedAt,
        error: lastError,
      };
    },
  };
}
