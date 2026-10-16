import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneShotMetaText } from './scenePresentation.js';

test('scene shot meta uses the existing style and mode labels', () => {
  assert.equal(
    sceneShotMetaText({
      visual: { style: 'surveillance', detection: { mode: 'SPARSE' } },
      durationSec: 4,
      holdSec: 1.5,
    }),
    '夜视 · 稀疏 · 4.0s + 1.5s',
  );
  assert.equal(
    sceneShotMetaText({
      visual: { style: 'retro', detection: { mode: 'PANOPTIC' } },
      durationSec: 2,
      holdSec: 0,
    }),
    'CRT · 密集 · 2.0s + 0.0s',
  );
});

test('the bare detection token DENSE is left unchanged', () => {
  assert.equal(
    sceneShotMetaText({
      visual: { style: 'normal', detection: { mode: 'DENSE' } },
      durationSec: 1,
      holdSec: 1,
    }),
    '常规 · DENSE · 1.0s + 1.0s',
  );
});
