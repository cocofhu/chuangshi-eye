import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paintedCctvProvider,
  paintedCctvStatus,
  paintedCctvToken,
} from './feedLabel.js';

test('known CCTV source tokens paint in Chinese', () => {
  assert.equal(paintedCctvToken('streetview'), '街景');
  assert.equal(paintedCctvToken('SYNTHETIC'), '合成');
  assert.equal(paintedCctvToken('image'), '图像');
  assert.equal(paintedCctvToken('ok'), '正常');
  assert.equal(paintedCctvToken('degraded'), '降级');
});

test('unlisted English source ids are not pasted', () => {
  assert.equal(paintedCctvToken('txdot-its'), '未知');
  assert.equal(paintedCctvToken(''), '未知');
});

test('Chinese tokens and Google Street View stay', () => {
  assert.equal(paintedCctvToken('街景'), '街景');
  assert.equal(paintedCctvProvider('Google Street View'), 'Google Street View');
  assert.equal(paintedCctvProvider('Austin Open Data'), 'Austin Open Data');
});

test('known health sentences paint in Chinese', () => {
  assert.equal(paintedCctvStatus('Fallback Street View frame'), '街景回退画面');
  assert.equal(paintedCctvStatus('Upstream unavailable'), '上游不可用');
  assert.equal(paintedCctvStatus('No source configured'), '未配置来源');
  assert.equal(paintedCctvStatus('NO FEED'), '无画面');
  assert.equal(paintedCctvProvider('Synthetic fallback'), '合成回退');
});

test('unlisted English health text is replaced', () => {
  assert.equal(paintedCctvStatus('Camera upstream timed out'), '说明未识别');
  assert.equal(paintedCctvStatus('上游已恢复'), '上游已恢复');
});
