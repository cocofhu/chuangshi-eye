/** Resolve the visible surface that can own weather imagery without scene mutation. */
export function resolveImageryHost({ viewer, tileset }) {
  if (viewer?.scene?.globe?.show === true)
    return { collection: viewer.imageryLayers, kind: 'globe' };
  if (tileset?.imageryLayers)
    return { collection: tileset.imageryLayers, kind: 'tileset' };
  return { collection: null, kind: 'none' };
}

export const NO_IMAGERY_HOST = '当前地图源已隐藏 · 请改用地球地图';

/** Report imagery suspension without changing or detaching the resolved host. */
export function imageryHostStatus(host) {
  return host.kind === 'none' ? NO_IMAGERY_HOST : null;
}
