import * as Cesium from 'cesium';
import { outOfChina } from '../../china/gcj02.js';

const STATUS_COLORS = Object.freeze({
  0: '#9aa4ad',
  1: '#34c759',
  2: '#ffcc00',
  3: '#ff3b30',
  4: '#8e1b1b',
});
export const AMAP_TRAFFIC_STATUS = Object.freeze({
  0: '未知',
  1: '畅通',
  2: '缓行',
  3: '拥堵',
  4: '严重拥堵',
});
const MAX_ALTITUDE_M = 60_000;

/** Camera ground point when it is low enough over China for a city query. */
export function trafficQueryPoint(camera) {
  const carto = camera?.positionCartographic;
  if (!carto || carto.height > MAX_ALTITUDE_M) return null;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  return outOfChina(lon, lat) ? null : { lon, lat };
}

/** 高德实时路况：以视野中心约 6 × 5 公里范围查询道路拥堵状态。 */
export function createAmapTrafficLayer({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let request = null;
  let shownKey = null;
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let description = '';
  let keyRequired = false;

  return {
    id: 'amap-traffic',
    name: '高德实时路况',
    icon: '🚦',
    source: '高德地图',
    requiresKeyId: 'amap',
    updateInterval: 120_000,

    init(value) {
      viewer = value;
      dataSource = new Cesium.CustomDataSource('amap-traffic');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      if (dataSource) {
        dataSource.show = false;
        dataSource.entities.removeAll();
      }
      shownKey = null;
      count = 0;
    },

    async update() {
      if (!enabled || !viewer || !dataSource) return false;
      const point = trafficQueryPoint(viewer.camera);
      if (!point) {
        lastError = '请将视角拉近到国内城市（60 公里以下）';
        return false;
      }
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const params = new URLSearchParams({
          lon: point.lon.toFixed(5),
          lat: point.lat.toFixed(5),
        });
        const response = await fetchImpl(`/api/amap/traffic?${params}`, {
          signal: controller.signal,
        });
        keyRequired = response.status === 503;
        if (keyRequired)
          throw new Error('需要在「接入数据」中配置高德 Web 服务 Key');
        if (!response.ok)
          throw new Error(`高德路况暂不可用 (HTTP ${response.status})`);
        const payload = await response.json();
        if (controller.signal.aborted || !enabled) return false;
        const roads = Array.isArray(payload?.roads) ? payload.roads : [];
        const key = `${payload.center}|${payload.fetchedAt}`;
        if (key !== shownKey) {
          dataSource.entities.removeAll();
          for (const road of roads) {
            dataSource.entities.add({
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(road.line.flat()),
                width: road.status >= 3 ? 5 : 4,
                material: Cesium.Color.fromCssColorString(
                  STATUS_COLORS[road.status] || STATUS_COLORS[0],
                ),
                clampToGround: true,
              },
              properties: {
                name: road.name,
                status: AMAP_TRAFFIC_STATUS[road.status] || '未知',
                speedKmh: road.speedKmh,
              },
            });
          }
          shownKey = key;
        }
        count = roads.length;
        description =
          typeof payload.description === 'string' ? payload.description : '';
        lastUpdate = Date.now();
        lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        lastError = error?.message || '高德路况暂不可用';
        return false;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy() {
      enabled = false;
      request?.abort();
      request = null;
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
    },

    getStats() {
      return { count, lastUpdate, error: lastError, description, keyRequired };
    },
  };
}
