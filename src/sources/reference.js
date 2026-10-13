import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createChinaEarthquakeSource } from '../china/earthquakes.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createChinaEarthquakeSource({
      usgs: createUsgsEarthquakeSource(),
    }),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
  };
}
