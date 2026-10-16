import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, paintedFailure } from './errors.js';

test('startup text maps known English failures and hides the rest', () => {
  assert.equal(describeError(null), '未知的启动错误');
  assert.equal(describeError(new Error('')), 'Error');
  assert.equal(
    paintedFailure('Google 3D tokens are not offered'),
    '未提供 Google 三维令牌',
  );
  assert.equal(
    paintedFailure('Missing 3D source: photoreal'),
    '缺少三维地图源',
  );
  assert.equal(paintedFailure('Request failed.'), '详情未识别');
  assert.equal(paintedFailure('天地图不可用，已切换到 Esri 卫星影像'), '天地图不可用，已切换到 Esri 卫星影像');
  assert.equal(paintedFailure('', '地图源切换失败'), '地图源切换失败');
});
