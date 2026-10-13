import * as Cesium from 'cesium';
import { hitTestWorldOverlay } from '../../overlays/worldOverlay.js';
import { VESSEL_OVERLAY_SOURCE_ID } from '../../data/vesselLabels.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import {
  createCycloneRendering,
  coherentCycloneGeometry,
} from './rendering.js';
import {
  CYCLONE_OVERLAY_SOURCE_ID,
  cycloneStormIdFromEntryId,
} from './labels.js';

const utc = (value) =>
  value ? `${value.slice(5, 16).replace('T', ' ')} UTC` : '暂无';
const COVERAGE =
  '西北太平洋与南海（中央气象台）、大西洋与东/中北太平洋（NOAA NHC/CPHC）。';
const CLASSIFICATION_NAMES = Object.freeze({
  PTC: '潜在热带气旋',
  HU: '飓风',
  TS: '热带风暴',
  TD: '热带低压',
  SS: '亚热带风暴',
  SD: '亚热带低压',
  STS: '强热带风暴',
  TY: '台风',
  STY: '强台风',
  SuperTY: '超强台风',
  TC: '热带气旋',
});
const classificationName = (code) =>
  Object.hasOwn(CLASSIFICATION_NAMES, code) ? CLASSIFICATION_NAMES[code] : code;
const number = (value, unit) => (value === null ? '暂无' : `${value} ${unit}`);

/** Advisory status and coherent forecast geometry; selected through the shared row list. */
export function createCyclonesLayer({
  feed,
  hitTestOverlay = hitTestWorldOverlay,
  overlayHost,
  cesium = Cesium,
  createRendering = createCycloneRendering,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  openLink = (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
} = {}) {
  if (typeof feed?.getSnapshot !== 'function')
    throw new TypeError('Cyclones require a snapshot source');
  let viewer = null,
    rendering = null,
    snapshot = null,
    request = null,
    listener = null,
    selectedId = null,
    selectionIntent = 'auto',
    navigationGeneration = 0,
    clickHandler = null,
    removeClickCapture = null;
  let enabled = false,
    loading = false,
    error = null,
    destroyed = false,
    runNavigation = null;
  const notify = () => listener?.();
  const selected = () =>
    snapshot?.storms.find((storm) => storm.id === selectedId) || null;
  function select(id) {
    if (selectedId !== id) ++navigationGeneration;
    selectedId = id;
    rendering?.setSelection(id);
  }
  // Photorealistic 3D Tiles pick as tileset content without an entity id;
  // that is empty map, the same as no pick at all on the globe.
  const isSurfacePick = (picked) =>
    !picked ||
    (picked.id === undefined &&
      (picked.content !== undefined ||
        (typeof cesium.Cesium3DTileset === 'function' &&
          picked.primitive instanceof cesium.Cesium3DTileset)));
  function installSelection() {
    if (
      clickHandler ||
      !viewer?.scene?.canvas ||
      typeof cesium.ScreenSpaceEventHandler !== 'function'
    )
      return;
    const owner = new cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandler = owner;
    // Snapshot before sibling bubble listeners can rebuild the overlay hit
    // rectangles. A vessel selection does that synchronously in the same click.
    const canvas = viewer.scene.canvas;
    let capturedHit = null;
    const overlayHit = (x, y) => {
      const hit = hitTestOverlay(x, y);
      return { sourceId: hit?.sourceId, entryId: hit?.entryId };
    };
    const capture = (event) => {
      capturedHit = null;
      const point = event.changedTouches?.[0] || event;
      if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY))
        return;
      const rect = canvas.getBoundingClientRect();
      const x = point.clientX - rect.left,
        y = point.clientY - rect.top;
      capturedHit = { x, y, ...overlayHit(x, y) };
    };
    const resetCapture = () => {
      capturedHit = null;
    };
    const resetEvents = [
      'pointerdown',
      'mousedown',
      'touchstart',
      'pointercancel',
      'touchcancel',
    ];
    for (const type of resetEvents)
      canvas.addEventListener?.(type, resetCapture, { capture: true });
    const events = ['pointerup', 'mouseup', 'touchend'];
    for (const type of events)
      canvas.addEventListener?.(type, capture, { capture: true });
    removeClickCapture = () => {
      for (const type of events)
        canvas.removeEventListener?.(type, capture, { capture: true });
      for (const type of resetEvents)
        canvas.removeEventListener?.(type, resetCapture, { capture: true });
      capturedHit = null;
    };
    owner.setInputAction((click) => {
      const nativeHit = capturedHit;
      capturedHit = null;
      // Ambient selection yields to draw tools and Director; it never claims
      // the pointer, camera, or tracking state.
      if (
        !enabled ||
        destroyed ||
        clickHandler !== owner ||
        !isPointerFree() ||
        !click?.position
      )
        return;
      // AIS cards paint above the globe on a pointer-events:none canvas. The
      // vessel handler resolves this same topmost hit before cyclone geometry.
      const captureMatches =
        nativeHit &&
        Math.abs(nativeHit.x - click.position.x) < 1 &&
        Math.abs(nativeHit.y - click.position.y) < 1;
      const hit = captureMatches
        ? nativeHit
        : overlayHit(click.position.x, click.position.y);
      if (hit.sourceId === VESSEL_OVERLAY_SOURCE_ID) return;
      // Storm cards and lead-hour labels paint on the same canvas; a click on
      // one selects its storm. An id from a superseded advisory changes nothing.
      if (hit.sourceId === CYCLONE_OVERLAY_SOURCE_ID) {
        const id = cycloneStormIdFromEntryId(hit.entryId);
        if (id) layer.setParams({ stormId: id });
        return;
      }
      const picked = viewer.scene.pick(click.position);
      const id = rendering?.pickStorm(picked);
      if (id) layer.setParams({ stormId: id });
      else if (isSurfacePick(picked)) layer.setParams({ clear: true });
    }, cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  function removeSelection() {
    const owner = clickHandler;
    clickHandler = null;
    removeClickCapture?.();
    removeClickCapture = null;
    if (owner && !owner.isDestroyed?.()) owner.destroy();
  }
  const layer = {
    id: 'weather-cyclones',
    name: 'Cyclone advisories',
    icon: '◉',
    source: 'NOAA NHC / CPHC',
    updateInterval: 300_000,
    init(nextViewer) {
      viewer = nextViewer;
      rendering = createRendering({ viewer, cesium, overlayHost });
    },
    attachShellServices(services) {
      runNavigation =
        typeof services?.runNavigation === 'function'
          ? services.runNavigation
          : null;
      notify();
    },
    enable() {
      if (!destroyed && !enabled) {
        enabled = true;
        registerPickOwner(
          'weather-cyclones',
          (id) => enabled && rendering?.ownsPickId?.(id) === true,
        );
        installSelection();
      }
    },
    disable() {
      enabled = false;
      unregisterPickOwner('weather-cyclones');
      removeSelection();
      request?.abort();
      request = null;
      loading = false;
      error = null;
      snapshot = null;
      selectedId = null;
      selectionIntent = 'auto';
      ++navigationGeneration;
      rendering?.clear();
    },
    async update(_viewer, { signal } = {}) {
      if (!enabled || destroyed) return false;
      request?.abort();
      const controller = new AbortController();
      if (signal?.aborted) controller.abort(signal.reason);
      request = controller;
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      loading = true;
      notify();
      try {
        signal?.throwIfAborted();
        const next = await feed.getSnapshot({ signal: controller.signal });
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        if (next.unavailable) {
          // An expired advisory must not remain presented as current hazard context.
          rendering.clear();
          snapshot = next;
          selectedId = null;
          ++navigationGeneration;
          error = next.reason || '台风与飓风公报暂不可用';
          return true;
        }
        const applied = await rendering.setSnapshot(next, {
          signal: controller.signal,
        });
        if (
          !applied ||
          !enabled ||
          controller.signal.aborted ||
          request !== controller
        )
          return false;
        snapshot = next;
        error = null;
        if (!snapshot.storms.some((storm) => storm.id === selectedId))
          select(
            selectionIntent === 'cleared'
              ? null
              : snapshot.storms[0]?.id || null,
          );
        else rendering.setSelection(selectedId);
        return true;
      } catch (cause) {
        if (controller.signal.aborted || request !== controller) return false;
        error = cause?.message || '台风与飓风公报暂不可用';
        // Failed acquisition has no bounded last-good age guarantee at this layer.
        rendering?.clear();
        snapshot = null;
        selectedId = null;
        ++navigationGeneration;
        return true;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (request === controller) {
          request = null;
          loading = false;
          notify();
        }
      }
    },
    setParams(params = {}) {
      if (!enabled || destroyed) return;
      if (params.clear === true || params.stormId === null) {
        selectionIntent = 'cleared';
        select(null);
        notify();
      } else if (
        typeof params.stormId === 'string' &&
        snapshot?.storms.some((storm) => storm.id === params.stormId)
      ) {
        selectionIntent = 'user';
        select(params.stormId);
        notify();
      }
      const storm = selected();
      if (params.focus === true && storm && runNavigation) {
        const sphere = rendering.getFocusSphere(storm.id);
        if (sphere) {
          const generation = ++navigationGeneration;
          runNavigation(() => {
            if (
              !enabled ||
              destroyed ||
              generation !== navigationGeneration ||
              selectedId !== storm.id
            )
              return;
            return viewer.camera.flyToBoundingSphere(sphere, {
              duration: matchMedia?.('(prefers-reduced-motion: reduce)')
                ?.matches
                ? 0
                : 1.4,
            });
          });
        }
      }
      if (params.advisory === true && storm?.advisoryUrl)
        openLink(storm.advisoryUrl);
    },
    getRowControls() {
      const storm = selected();
      const empty =
        snapshot && !snapshot.unavailable && snapshot.storms.length === 0;
      const geometry =
        storm &&
        (coherentCycloneGeometry(storm)
          ? '路径与不确定性锥对应本期公报'
          : storm.geometryStatus === 'pending'
            ? `路径与锥等待第 ${storm.advisoryNumber} 期公报`
            : '路径与锥暂不可用');
      const status =
        error ||
        (snapshot?.stale
          ? '缓存公报 · 来源已过期'
          : loading
            ? '正在加载公报…'
            : storm && !coherentCycloneGeometry(storm)
              ? geometry
              : null);
      const detail = storm
        ? `${storm.name} · ${classificationName(storm.classification)} · 第 ${storm.advisoryNumber} 期 · 发布 ${utc(storm.issuedAt)}`
        : empty
          ? '当前没有活跃的台风或飓风'
          : snapshot?.storms.length
            ? `${snapshot.storms.length} 个活跃系统`
            : loading
              ? '正在加载公报…'
              : '公报不可用';
      const controls = {
        readout: true,
        summary: {
          label: '台风 · 中央气象台 / NHC',
          coverage: '西北太平洋 · 南海 · 大西洋 · 东/中太平洋',
          compact: snapshot?.storms.length
            ? `${snapshot.storms.length} 个活跃系统${storm ? ` · 已选 ${storm.name}` : ''}`
            : detail,
          actions: storm?.advisoryUrl
            ? [
                {
                  id: 'advisory',
                  label:
                    storm.basin === 'WP' ? '中央气象台台风网 ↗' : '官方公报 ↗',
                  href: storm.advisoryUrl,
                },
              ]
            : [],
          settings: [],
          lines: storm
            ? [
                {
                  id: 'position',
                  text: `位置时间 ${utc(storm.positionAt)}`,
                  muted: true,
                },
                {
                  id: 'intensity',
                  text: `最大持续风速 ${number(storm.windKt, 'kt')} · 中心气压 ${number(storm.pressureHpa, 'hPa')}`,
                },
                { id: 'geometry', text: geometry, muted: true },
              ]
            : [],
          detail,
          status,
          units: 'kt',
        },
        list: {
          ariaLabel: '活跃台风与飓风公报',
          items: (snapshot?.storms || []).map((item, index) => ({
            id: item.id,
            ordinal: index + 1,
            lead: item.basin,
            text: `${item.name} · ${classificationName(item.classification)} · ${item.windKt === null ? '风速暂无' : `${item.windKt} kt`}`,
            active: item.id === selectedId,
            params: { stormId: item.id, focus: true },
          })),
        },
        chips: [],
        legend: storm
          ? [
              { label: '中心位置 / 实况与预报路径', color: '#7fe6ed' },
              { label: '中心路径不确定性锥', color: '#7fe6ed44' },
            ]
          : [],
        info: storm
          ? `${detail}\n位置时间 ${utc(storm.positionAt)}\n最大持续风速 ${number(storm.windKt, 'kt')} · 中心气压 ${number(storm.pressureHpa, 'hPa')}\n${geometry}${status && status !== geometry ? '\n' + status : ''}\n${snapshot.coverage}`
          : `${detail}${status ? '\n' + status : ''}\n${snapshot?.coverage || COVERAGE}`,
        infoTitle:
          '在地图上点选台风，或在列表中选择以选中并移动视角；点击空白处取消选择。西北太平洋台风来自中央气象台实况与 BABJ 预报，其不确定性锥按典型路径误差半径估算；大西洋与东太平洋来自 NOAA NHC/CPHC。锥表示中心路径的不确定性，不代表风圈大小或完整影响范围。预报点标签为来源给出的预报时效。请以官方发布为准。',
      };
      return controls;
    },
    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },
    /**
     * Snapshot loaded active storms as plain JSON-safe records for the analyst
     * query engine. On demand only (once per spoken query); [] while the
     * layer is off.
     * @param {number} [maxCount=Infinity] Most records to return.
     * @returns {Array<Object>} {id, name, classification, basin, lat, lon, windKt, pressureHpa}.
     */
    getAnalystRecords(maxCount = Infinity) {
      if (!enabled || destroyed) return [];
      const num = (v) => (Number.isFinite(v) ? v : null);
      const result = [];
      for (const storm of snapshot?.storms || []) {
        if (result.length >= maxCount) break;
        const lat = storm.position?.latitude;
        const lon = storm.position?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        result.push({
          id: storm.name || storm.id,
          name: storm.name || null,
          classification: storm.classification || null,
          basin: storm.basin || null,
          lat,
          lon,
          windKt: num(storm.windKt),
          pressureHpa: num(storm.pressureHpa),
        });
      }
      return result;
    },
    getStats() {
      const storm = selected();
      return {
        count: snapshot?.storms.length || 0,
        lastUpdate: storm
          ? Date.parse(storm.issuedAt)
          : snapshot?.fetchedAt || null,
        loading,
        error,
        stale: Boolean(snapshot?.stale),
        source: 'NOAA NHC / CPHC',
        advisoryAt: storm?.issuedAt || null,
        empty: Boolean(
          snapshot && !snapshot.unavailable && !snapshot.storms.length,
        ),
      };
    },
    getDiagnostics() {
      return {
        ...rendering?.getDiagnostics(),
        enabled,
        loading,
        requestPending: !!request,
        selectionActive: clickHandler !== null,
        selectedId,
        selectionIntent,
        timerActive: false,
      };
    },
    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      rendering?.destroy();
      rendering = null;
      viewer = null;
      listener = null;
      runNavigation = null;
    },
  };
  return layer;
}
