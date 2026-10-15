import {
  array,
  fields,
  string,
  optional,
  uniqueId,
  fail,
} from '../documentFields.js';

/** Validate inert, scene-local actions. Feature existence is checked after asset loading. */
export function validateSceneInteractions(scene, path) {
  const packs = new Map((scene.dataPacks || []).map((p) => [p.id, p]));
  const anchors = new Set((scene.anchors || []).map((a) => a.id));
  const shots = new Map(scene.shots.map((s) => [s.id, s]));
  scene.shots.forEach((shot, index) => {
    optional(shot, 'interactions', `${path}.shots[${index}]`, (items, at) => {
      array(items, at, 64);
      const seen = new Set();
      items.forEach((item, i) => {
        const field = `${at}[${i}]`;
        fields(item, field, ['id', 'label', 'target', 'action']);
        string(item.id, field);
        uniqueId(item, field, seen);
        string(item.label, field, 256);
        fields(item.target, `${field}.target`, ['packId', 'featureId']);
        string(item.target.packId, field);
        string(item.target.featureId, field);
        if (
          packs.get(item.target.packId)?.format !== 'geojson' ||
          !shot.dataPackIds?.includes(item.target.packId)
        )
          fail(field, '目标必须属于已选的 GeoJSON 素材包');
        const a = item.action;
        const specs = {
          card: ['text', 'url'],
          focus: ['anchorId'],
          shot: ['shotId'],
          layer: ['layerId', 'enabled'],
        };
        if (!a || !Object.hasOwn(specs, a.type))
          fail(field, '不支持的操作');
        string(a.type, `${field}.action.type`);
        fields(a, `${field}.action`, ['type', ...specs[a.type]]);
        const reference = {
          focus: 'anchorId',
          shot: 'shotId',
          layer: 'layerId',
        }[a.type];
        if (reference) string(a[reference], `${field}.action.${reference}`);
        if (a.type === 'card') {
          string(a.text, field, 4096);
          optional(a, 'url', field, (url, at) => {
            string(url, at, 2048);
            let parsed;
            try {
              parsed = new URL(url);
            } catch {
              fail(at, '需要 HTTPS 来源网址');
            }
            if (
              parsed.protocol !== 'https:' ||
              parsed.username ||
              parsed.password ||
              parsed.search ||
              parsed.hash
            )
              fail(
                at,
                '需要不含凭据、查询或片段的 HTTPS 来源网址',
              );
          });
        } else if (a.type === 'focus' && !anchors.has(a.anchorId))
          fail(field, '未知锚点');
        else if (a.type === 'shot') {
          const target = shots.get(a.shotId);
          if (!target) fail(field, '未知镜头');
          // A transition must restore every layer this shot can change.
          for (const entry of items)
            if (
              entry?.action?.type === 'layer' &&
              !Object.hasOwn(target.layers || {}, entry.action.layerId)
            )
              fail(
                field,
                '目标镜头必须声明可交互图层基线',
              );
        } else if (a.type === 'layer') {
          if (!Object.hasOwn(shot.layers || {}, a.layerId))
            fail(field, '图层必须有明确的镜头基线');
          if (typeof a.enabled !== 'boolean')
            fail(field, '需要启用状态的布尔值');
        }
      });
    });
  });
}
