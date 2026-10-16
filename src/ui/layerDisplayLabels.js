/** Chinese names already used by the data-layer menu. Internal `layer.name` stays unchanged. */
export const LAYER_DISPLAY_LABELS = Object.freeze({
  satellites: '卫星轨道',
  flights: '民航航班',
  military: '军用航空器',
  'local-adsb': '本地 ADS-B',
  'ais-live-vessels': '实时船舶',
  traffic: '道路车流',
  transit: '公共交通',
  bikeshare: '共享单车',
  cctv: '公开摄像头',
  'recent-imagery': '近期卫星影像',
  'street-level': '街景',
  'alpr-cameras': '已标注车牌识别摄像头',
  'military-installations': '军事设施',
  'local-datacenters': '数据中心',
  'telegeography-submarine-cables': '海底光缆',
  'local-dams': '水坝',
  'rocket-launches': '火箭发射',
  earthquakes: '地震',
  'local-firms': '活跃火点',
  'fire-perimeters': '山火范围',
  wind: '风场',
  'weather-radar': '天气雷达',
  'weather-satellite': '红外云图',
  'weather-lightning': '闪电',
  'weather-cyclones': '台风与飓风',
  directions: '路径规划',
  radio: '网络电台',
  'fengyun-cloud': '风云四号云图',
  'amap-traffic': '高德实时路况',
});

/** Menu label for a layer id. Unknown rows keep their existing name. */
export function layerDisplayLabel(layer = {}) {
  const id = layer?.id || layer?.layerId;
  if (id && LAYER_DISPLAY_LABELS[id]) return LAYER_DISPLAY_LABELS[id];
  return layer?.name || id || '图层';
}
