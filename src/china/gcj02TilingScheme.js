import * as Cesium from 'cesium';
import { gcj02ToWgs84, wgs84ToGcj02 } from './gcj02.js';

/**
 * Web Mercator tiling whose tiles are addressed in GCJ-02.
 *
 * Cesium asks for the tile covering a WGS-84 rectangle. Projecting that
 * rectangle through the GCJ-02 offset first makes the requested Amap tile
 * line up with the globe instead of sitting a few hundred metres off.
 */
export class Gcj02TilingScheme extends Cesium.WebMercatorTilingScheme {
  constructor(options) {
    super(options);
    const projection = new Cesium.WebMercatorProjection(this.ellipsoid);
    this._projection = {
      ellipsoid: this.ellipsoid,
      project(cartographic, result) {
        const [lon, lat] = wgs84ToGcj02(
          Cesium.Math.toDegrees(cartographic.longitude),
          Cesium.Math.toDegrees(cartographic.latitude),
        );
        return projection.project(
          new Cesium.Cartographic(
            Cesium.Math.toRadians(lon),
            Cesium.Math.toRadians(lat),
            cartographic.height,
          ),
          result,
        );
      },
      unproject(cartesian, result) {
        const cartographic = projection.unproject(cartesian);
        const [lon, lat] = gcj02ToWgs84(
          Cesium.Math.toDegrees(cartographic.longitude),
          Cesium.Math.toDegrees(cartographic.latitude),
        );
        const out = result || new Cesium.Cartographic();
        out.longitude = Cesium.Math.toRadians(lon);
        out.latitude = Cesium.Math.toRadians(lat);
        out.height = cartographic.height;
        return out;
      },
    };
  }
}
