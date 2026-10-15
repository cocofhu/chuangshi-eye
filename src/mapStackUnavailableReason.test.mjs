import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MapStackController,
  photorealUnavailableReason,
} from './mapStackController.js';

test('missing photoreal credentials explain both supported setup routes', () => {
  assert.match(
    photorealUnavailableReason(false),
    /需要 GOOGLE_MAPS_API_KEY.*提供者设置/,
  );
  assert.match(photorealUnavailableReason(false), /Cesium ion 令牌/);
});

test('a configured but failed photoreal route does not ask for another key', () => {
  const reason = photorealUnavailableReason(true);
  assert.match(reason, /不可用.*限制、额度或网络/);
  assert.doesNotMatch(reason, /需要|请在提供者设置中添加/);
});

test('controller credential detection accepts ion without a browser global', () => {
  const hasCredentials = MapStackController.prototype._hasPhotorealCredentials;
  assert.equal(hasCredentials.call({ cesiumToken: 'configured' }), true);
  assert.equal(hasCredentials.call({ cesiumToken: '   ' }), false);
});
