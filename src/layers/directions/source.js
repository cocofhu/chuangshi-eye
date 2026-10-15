const ROUTE_ERROR_TEXT = Object.freeze({
  'no route found': 'A 与 B 之间没有路线',
  'rate limited': '路径规划限流 — 请稍后再试',
  'routing busy — too many routes at once': '路径规划繁忙 — 同时请求过多',
  'routing service is rate limited': '路径规划服务限流 — 请稍后再试',
  'invalid profile': '路径模式无效',
  'need 2-12 coordinates': '需要 2 到 12 个坐标',
  'invalid coordinate': '坐标无效',
  'route leg too long': '单段路程过长',
  'route too long': '总路程过长',
  'route proxy error': '路径服务出错',
});

/** Chinese row text for a known route-proxy error. Unknown text stays off the row. */
export function routeErrorText(error, fallback = '路径规划不可用') {
  return typeof error === 'string' && ROUTE_ERROR_TEXT[error]
    ? ROUTE_ERROR_TEXT[error]
    : fallback;
}

/** Build the existing route-proxy query from geographic endpoints. */
export function directionsRequestUrl(mode, a, b) {
  const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
  return `/api/route?profile=${encodeURIComponent(mode)}&coords=${encodeURIComponent(coords)}&steps=1`;
}

/** Acquire route records using caller-owned transport and an optional endpoint. */
export function createDirectionsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/route',
} = {}) {
  return {
    async getRoute({ mode, a, b }, { signal } = {}) {
      signal?.throwIfAborted();
      const query = directionsRequestUrl(mode, a, b).split('?')[1];
      const response = await fetchImpl(`${endpoint}?${query}`, {
        signal,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      signal?.throwIfAborted();
      if (response.status === 429) {
        throw new Error(
          routeErrorText(payload?.error, '路径规划限流 — 请稍后再试'),
        );
      }
      if (!response.ok && !payload?.error)
        throw new Error(`路径规划不可用（HTTP ${response.status}）`);
      return payload;
    },
  };
}
