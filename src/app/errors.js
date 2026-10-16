const LOADER_FAILURE = {
  'Google 3D requires an explicit browser key': '需要 Google 三维浏览器密钥',
  'Google 3D tokens are not offered': '未提供 Google 三维令牌',
  'Google 3D through ion requires an explicit token':
    '通过 Cesium ion 使用 Google 三维需要令牌',
  'Ion imagery requires an explicit token': 'Cesium ion 影像需要令牌',
  'Map source fallback cycle': '地图源回退出现循环',
};

/** User-facing startup or map-switch text. English diagnostics stay in the console. */
export function paintedFailure(detail, fallback = '详情未识别') {
  const text = String(detail || '').trim();
  if (!text) return fallback;
  if (LOADER_FAILURE[text]) return LOADER_FAILURE[text];
  if (/^Missing 3D source: /.test(text)) return '缺少三维地图源';
  if (/[\u4e00-\u9fff]/.test(text)) return text;
  return fallback;
}

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
export function describeError(error) {
  if (!error) return '未知的启动错误';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || '启动错误';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}
