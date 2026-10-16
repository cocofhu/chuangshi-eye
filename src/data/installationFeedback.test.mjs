import test from 'node:test';
import assert from 'node:assert/strict';
import { installationFeedback } from './installationFeedback.js';

test('retry copy follows the real deadline and does not promise an overdue timer fired', () => {
  assert.equal(installationFeedback({ retryAt: 31000 }, 1000), 'Overpass 暂不可用 — 30 秒后重试');
  assert.match(installationFeedback({ retryAt: 31000 }, 32000), /等待重试$/);
  assert.match(installationFeedback({ retryAt: 241000 }, 1000), /240 秒后重试$/);
});
test('only known failure reasons get specific attribution', () => {
  for (const [failureReason, text] of [['rate_limited', '限流'], ['timeout', '超时'], ['query_failed', '查询未完成']]) {
    assert.ok(installationFeedback({ status: 'unavailable', failureReason }).includes(text));
  }
  assert.match(installationFeedback({ status: 'unavailable', failureReason: 'unknown' }), /暂不可用/);
});
test('first fetch, retry, cached data and success have distinct copy', () => {
  assert.equal(installationFeedback({ loading: true }), '正在获取标注站点…');
  assert.equal(installationFeedback({ loading: true, retrying: true }), '正在重试标注站点…');
  assert.equal(installationFeedback({ status: 'ready' }), '标注站点已加载');
  assert.equal(installationFeedback({ stale: true }), '显示缓存的标注站点');
});
test('a counted result names what was found and where', () => {
  assert.equal(installationFeedback({ status: 'ready', count: 3 }), '3 个标注站点（视野内）');
  assert.equal(installationFeedback({ status: 'empty', count: 0 }), '暂无标注站点（视野内）');
  const coverage = { kind: 'subject', radiusM: 100_000 };
  assert.equal(
    installationFeedback({ status: 'ready', count: 1, coverage }),
    '1 个标注站点（目标周边 100 公里）',
  );
  assert.equal(
    installationFeedback({ status: 'unavailable', failureReason: 'tiles_unavailable' }),
    '地图瓦片暂不可用',
  );
});
