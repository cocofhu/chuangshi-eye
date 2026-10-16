const SHOT_STYLE_LABELS = {
  normal: '常规',
  retro: 'CRT',
  surveillance: '夜视',
  thermal: '热成像',
  anime: '动漫',
  noir: '黑白',
  snow: '风雪',
};

const SHOT_MODE_LABELS = {
  OFF: '关',
  SPARSE: '稀疏',
  SURVEY: '稀疏',
  BALANCED: '均衡',
  NORMAL: '均衡',
  PANOPTIC: '密集',
};

/** Shot row meta. The bare detection token DENSE stays unchanged. */
export function sceneShotMetaText(shot) {
  const mode = String(shot?.visual?.detection?.mode || 'OFF');
  const style = String(shot?.visual?.style || 'normal');
  const styleLabel = SHOT_STYLE_LABELS[style] || style.toUpperCase();
  const modeKey = mode.toUpperCase();
  const modeLabel =
    modeKey === 'DENSE' ? 'DENSE' : SHOT_MODE_LABELS[modeKey] || mode;
  const duration = Number(shot?.durationSec);
  const hold = Number(shot?.holdSec);
  const durationText = Number.isFinite(duration) ? duration.toFixed(1) : '0.0';
  const holdText = Number.isFinite(hold) ? hold.toFixed(1) : '0.0';
  return `${styleLabel} · ${modeLabel} · ${durationText}s + ${holdText}s`;
}

/** Scene panel elements and text-only project presentation. */
export function sceneElements(root = document) {
  const ids = {
    panel: 'scene-panel',
    select: 'scene-select',
    new: 'scene-new-btn',
    delete: 'scene-delete-btn',
    capture: 'scene-capture-btn',
    update: 'scene-update-shot-btn',
    shots: 'scene-shot-list',
    start: 'scene-start-btn',
    stop: 'scene-stop-btn',
    next: 'scene-next-btn',
    export: 'scene-export-btn',
    import: 'scene-import-btn',
    file: 'scene-import-file',
    download: 'scene-download-btn',
    status: 'scene-status',
    progress: 'scene-progress-fill',
    runtime: 'scene-runtime',
  };
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, root.getElementById(id)]),
  );
}

export function renderSceneOptions(element, { scenes, selectedSceneId }) {
  if (!element) return;
  element.textContent = '';
  for (const scene of scenes) {
    const option = document.createElement('option');
    option.value = scene.id;
    option.textContent = scene.title;
    element.appendChild(option);
  }
  if (selectedSceneId) element.value = selectedSceneId;
}

export function renderSceneShots(
  element,
  state,
  { listen, select, rename, load, remove },
) {
  if (!element) return;
  const scene = state.scenes.find((item) => item.id === state.selectedSceneId);
  element.textContent = '';
  if (!scene || scene.shots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scene-shot-empty';
    empty.textContent = '暂无镜头。用「捕捉镜头」保存当前视角。';
    element.appendChild(empty);
    return;
  }
  for (const shot of scene.shots) {
    const row = document.createElement('div');
    row.className = 'scene-shot-row';
    row.dataset.sceneShotId = shot.id;
    row.classList.toggle('active', shot.id === state.selectedShotId);
    const top = document.createElement('div');
    top.className = 'scene-shot-top';
    const label = document.createElement('div');
    label.className = 'scene-shot-label';
    label.textContent = shot.title;
    label.title = '双击重命名';
    listen(label, 'click', () => select(shot.id));
    listen(label, 'dblclick', () => {
      if (label.children.length) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'scene-shot-rename';
      input.setAttribute('aria-label', '镜头名称');
      input.value = shot.title;
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        const title = input.value.trim();
        label.textContent = shot.title;
        if (save && title && title !== shot.title)
          rename(scene.id, shot.id, title);
      };
      listen(input, 'keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          finish(event.key === 'Enter');
        }
      });
      listen(input, 'blur', () => finish(true));
      label.textContent = '';
      label.appendChild(input);
      input.focus();
      input.select();
    });
    const actions = document.createElement('div');
    actions.className = 'scene-shot-actions';
    const loadButton = document.createElement('button');
    loadButton.className = 'scene-shot-btn';
    loadButton.textContent = '载入';
    listen(loadButton, 'click', () => load(scene.id, shot.id));
    const deleteButton = document.createElement('button');
    deleteButton.className = 'scene-shot-btn scene-shot-danger';
    deleteButton.textContent = '删除';
    listen(deleteButton, 'click', () => remove(scene.id, shot.id));
    actions.appendChild(loadButton);
    actions.appendChild(deleteButton);
    top.appendChild(label);
    top.appendChild(actions);
    const meta = document.createElement('div');
    meta.className = 'scene-shot-meta';
    meta.textContent = sceneShotMetaText(shot);
    row.appendChild(top);
    row.appendChild(meta);
    element.appendChild(row);
  }
}

export function presentSceneSelection(element, selectedShotId) {
  for (const row of element?.children || []) {
    row.classList.toggle('active', row.dataset.sceneShotId === selectedShotId);
  }
}

export function presentSceneButtons(elements, running, hasRun) {
  for (const name of [
    'start',
    'next',
    'select',
    'new',
    'delete',
    'capture',
    'update',
    'export',
    'import',
  ]) {
    if (elements[name]) elements[name].disabled = running;
  }
  if (elements.stop) elements.stop.disabled = !running;
  if (elements.download) elements.download.disabled = !hasRun;
  elements.panel?.classList.toggle('running', running);
}

export function presentSceneProgress(element, progress) {
  if (!element) return;
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  element.style.width = `${percentage}%`;
  element.textContent = `${percentage}%`;
}

export function presentSceneRuntime(element, text) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('active', !!text);
}
