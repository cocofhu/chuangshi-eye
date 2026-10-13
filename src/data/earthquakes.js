import { createUsgsEarthquakeSource } from '../layers/earthquakes/index.js';
import { createApplicationEarthquakes } from '../app/layers/earthquakes.js';
import { createChinaEarthquakeSource } from '../china/earthquakes.js';
export * from '../layers/earthquakes/index.js';
/** Wire the standalone source and application overlay owner. */
export function createEarthquakesLayer({
  source = createChinaEarthquakeSource({ usgs: createUsgsEarthquakeSource() }),
  ...options
} = {}) {
  return createApplicationEarthquakes({ source, ...options });
}
export default createEarthquakesLayer();
