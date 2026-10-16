import {
  fields,
  string,
  number,
  optional,
  array,
  fail,
  uniqueId,
} from './documentFields.js';

const POSITION = { lat: [-90, 90], lon: [-180, 180], alt: [-12000, 1e9] };
const ORIENTATION = {
  heading: [-360, 360],
  pitch: [-90, 90],
  roll: [-360, 360],
};
function coordinates(value, path, bounds, required, legacy) {
  for (const [key, range] of Object.entries(bounds)) {
    if (required || Object.hasOwn(value, key))
      number(value[key], `${path}.${key}`, ...range, legacy);
  }
}
function reference(value, path) {
  if (value !== 'ellipsoid')
    fail(
      path,
      '需要椭球高（米）；不支持相对地形高度',
    );
}
function pose(value, path, version, anchorIds, explicit = false) {
  const anchored = version >= 4 && Object.hasOwn(value || {}, 'anchorId');
  fields(value, path, [
    ...Object.keys(ORIENTATION),
    ...(anchored
      ? ['anchorId']
      : [
          ...Object.keys(POSITION),
          ...(version >= 4 ? ['altitudeReference'] : []),
        ]),
  ]);
  coordinates(value, path, ORIENTATION, false, version < 3);
  if (anchored) {
    string(value.anchorId, `${path}.anchorId`);
    if (!anchorIds.has(value.anchorId))
      fail(`${path}.anchorId`, '未知场景锚点');
  } else {
    coordinates(value, path, POSITION, explicit, version < 3);
    if (explicit || Object.hasOwn(value, 'altitudeReference'))
      reference(value.altitudeReference, `${path}.altitudeReference`);
  }
}

/** Validate scene-local anchor IDs, camera references and explicit motion without reading terrain or applying state. */
export function validateSceneCameras(scene, path, version) {
  const anchorIds = new Set();
  optional(scene, 'anchors', path, (anchors, field) => {
    array(anchors, field, 1024);
    anchors.forEach((anchor, i) => {
      const at = `${field}[${i}]`;
      fields(anchor, at, [
        'id',
        'title',
        ...Object.keys(POSITION),
        'altitudeReference',
      ]);
      string(anchor.id, `${at}.id`);
      uniqueId(anchor, at, anchorIds);
      optional(anchor, 'title', at, (v, p) => string(v, p, 4096));
      coordinates(anchor, at, POSITION, true, false);
      reference(anchor.altitudeReference, `${at}.altitudeReference`);
    });
  });
  scene.shots.forEach((shot, index) => {
    const at = `${path}.shots[${index}]`;
    optional(shot, 'move', at, (move, field) => {
      fields(move, field, ['from', 'easing']);
      if (!['linear', 'cubic-in-out'].includes(move.easing))
        fail(`${field}.easing`, '缓动应为 linear 或 cubic-in-out');
      pose(move.from, `${field}.from`, version, anchorIds, true);
      pose(shot.camera, `${at}.camera`, version, anchorIds, true);
      number(shot.durationSec, `${at}.durationSec`, 0.2, 86400, false);
      number(shot.holdSec, `${at}.holdSec`, 0, 86400, false);
    });
    optional(shot, 'camera', at, (camera, field) =>
      pose(camera, field, version, anchorIds),
    );
  });
}
