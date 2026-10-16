/** Client paint labels for CCTV source tokens. Server bodies stay unchanged. */

const KIND = {
  image: '图像',
  video: '视频',
  mp4: '视频',
  hls: '视频',
  webm: '视频',
  seed: '内置',
  configured: '已配置',
  streetview: '街景',
  synthetic: '合成',
  snapshot: '快照',
  unknown: '未知',
};

const STATUS = {
  ok: '正常',
  degraded: '降级',
  unknown: '未知',
  'upstream unavailable': '上游不可用',
  'no source configured': '未配置来源',
  'fallback street view frame': '街景回退画面',
  'upstream snapshot active': '上游快照可用',
  'no feed': '无画面',
  'synthetic fallback': '合成回退',
  'configured source': '已配置来源',
};

const PROVIDER = {
  'google street view': 'Google Street View',
  'synthetic fallback': '合成回退',
  'configured source': '已配置来源',
};

const CJK = /[\u4e00-\u9fff]/;

function normalized(value) {
  return String(value ?? '').trim();
}

/** Badge and overlay tokens. Unknown English ids become the fallback. */
export function paintedCctvToken(value, fallback = '未知') {
  const text = normalized(value);
  if (!text) return fallback;
  if (CJK.test(text)) return text;
  const key = text.toLowerCase();
  return KIND[key] || STATUS[key] || fallback;
}

/** Status sentences and health messages. Unknown English is not pasted. */
export function paintedCctvStatus(value, fallback = '说明未识别') {
  const text = normalized(value);
  if (!text) return fallback;
  if (CJK.test(text)) return text;
  const key = text.toLowerCase();
  return STATUS[key] || KIND[key] || fallback;
}

/**
 * Provider line. Known fallback phrases are translated. Other names stay,
 * including Google Street View.
 */
export function paintedCctvProvider(value, fallback = '已配置来源') {
  const text = normalized(value);
  if (!text) return fallback;
  if (CJK.test(text)) return text;
  return PROVIDER[text.toLowerCase()] || text;
}
