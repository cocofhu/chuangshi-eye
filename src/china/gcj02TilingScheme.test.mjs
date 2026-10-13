import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { Gcj02TilingScheme } from './gcj02TilingScheme.js';

test('GCJ-02 tiles match Web Mercator outside China and shift inside it', () => {
  const plain = new Cesium.WebMercatorTilingScheme();
  const shifted = new Gcj02TilingScheme();
  const london = Cesium.Cartographic.fromDegrees(-0.1276, 51.5072);
  assert.deepEqual(
    shifted.positionToTileXY(london, 8),
    plain.positionToTileXY(london, 8),
  );
  const beijing = Cesium.Cartographic.fromDegrees(116.397, 39.908);
  const plainPoint = plain.projection.project(beijing);
  const shiftedPoint = shifted.projection.project(beijing);
  const metres = Math.hypot(
    shiftedPoint.x - plainPoint.x,
    shiftedPoint.y - plainPoint.y,
  );
  assert.ok(metres > 200 && metres < 1500, `unexpected offset ${metres} m`);
  const plainTile = plain.positionToTileXY(beijing, 18);
  const shiftedTile = shifted.positionToTileXY(beijing, 18);
  const drift = Math.hypot(
    shiftedTile.x - plainTile.x,
    shiftedTile.y - plainTile.y,
  );
  assert.ok(drift >= 1 && drift < 20, `unexpected tile drift ${drift}`);
  const rectangle = shifted.tileXYToRectangle(
    shiftedTile.x,
    shiftedTile.y,
    18,
  );
  assert.ok(
    Cesium.Rectangle.contains(rectangle, beijing),
    'the shifted tile must still cover the WGS-84 point',
  );
});
