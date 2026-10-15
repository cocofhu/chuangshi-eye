import { keySetupRequirement } from '../keySetupCore.mjs';
/**
 * Why Google 3D is unavailable, phrased so the tooltip and toast recommend the
 * RIGHT fix. With no credentials the fix is a key (or the ion route); with a
 * key or ion token configured, the tileset failed for another reason —
 * restrictions, quota, an EEA-billed key, or the network — and telling the
 * user to add a key they already added is the wrong advice.
 * @param {boolean} hasCredentials
 * @returns {string}
 */
export function photorealUnavailableReason(hasCredentials) {
  if (hasCredentials)
    return 'Google 3D 瓦片不可用 — 请检查密钥的 API 限制、额度或网络';
  return `${keySetupRequirement('google-maps')} — 或使用 Cesium ion 令牌走 ion 托管路线`;
}
