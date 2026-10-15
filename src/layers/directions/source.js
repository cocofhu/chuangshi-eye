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
          typeof payload?.error === 'string' && payload.error
            ? `${payload.error} — 请稍后再试`
            : '路径规划限流 — 请稍后再试',
        );
      }
      if (!response.ok && !payload?.error)
        throw new Error(`路径规划不可用（HTTP ${response.status}）`);
      return payload;
    },
  };
}
