import test from 'node:test';
import assert from 'node:assert/strict';
import { paintedFeedCoverage } from './coverageLabel.js';

test('known flight coverage phrases paint in Chinese', () => {
  assert.equal(paintedFeedCoverage('worldwide upstream snapshot'), '全球上游快照');
  assert.equal(paintedFeedCoverage('military upstream snapshot'), '军用上游快照');
  assert.equal(
    paintedFeedCoverage('250nm regional fallback'),
    '250 nm 区域回退',
  );
  assert.equal(paintedFeedCoverage('250 nm regional'), '250 nm 区域回退');
});

test('provider names and Chinese coverage stay unchanged', () => {
  assert.equal(paintedFeedCoverage('adsb.lol'), 'adsb.lol');
  assert.equal(paintedFeedCoverage('OpenSky Network'), 'OpenSky Network');
  assert.equal(paintedFeedCoverage('MBTA 1'), 'MBTA 1');
  assert.equal(paintedFeedCoverage('仅当前视野'), '仅当前视野');
  assert.equal(paintedFeedCoverage(''), '');
});
