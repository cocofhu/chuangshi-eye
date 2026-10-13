import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amapLocationToWgs84,
  amapPolylineToWgs84,
  gcj02ToWgs84,
  outOfChina,
  wgs84ToGcj02,
} from './gcj02.js';

test('GCJ-02 shifts mainland points by a few hundred metres', () => {
  const [lon, lat] = wgs84ToGcj02(116.3912, 39.9073);
  assert.ok(lon - 116.3912 > 0.005 && lon - 116.3912 < 0.008);
  assert.ok(lat - 39.9073 > 0.0005 && lat - 39.9073 < 0.0025);
});

test('the inverse round-trips to centimetre precision', () => {
  for (const [lon, lat] of [
    [116.3975, 39.9087],
    [121.4998, 31.2397],
    [113.3245, 23.1066],
    [87.6168, 43.8256],
  ]) {
    const [gLon, gLat] = wgs84ToGcj02(lon, lat);
    const [wLon, wLat] = gcj02ToWgs84(gLon, gLat);
    assert.ok(Math.abs(wLon - lon) < 1e-7, `${lon},${lat}`);
    assert.ok(Math.abs(wLat - lat) < 1e-7, `${lon},${lat}`);
  }
});

test('points outside mainland China pass through unchanged', () => {
  assert.equal(outOfChina(-97.74, 30.27), true);
  assert.deepEqual(gcj02ToWgs84(-97.74, 30.27), [-97.74, 30.27]);
  assert.deepEqual(wgs84ToGcj02(139.65, 0.5), [139.65, 0.5]);
});

test('Amap location strings parse and reject malformed input', () => {
  const point = amapLocationToWgs84('116.397491,39.908715');
  assert.ok(Math.abs(point[0] - 116.3912) < 0.001);
  assert.equal(amapLocationToWgs84('abc'), null);
  assert.equal(amapLocationToWgs84('200,10'), null);
  assert.equal(amapLocationToWgs84(null), null);
  assert.equal(amapPolylineToWgs84('116.4,39.9;bad;116.5,39.95').length, 2);
  assert.deepEqual(amapPolylineToWgs84(''), []);
});
