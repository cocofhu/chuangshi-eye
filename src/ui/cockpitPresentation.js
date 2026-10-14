/** Pure formatting and fixed presentation constants used by Cockpit components. */
export const COCKPIT_HEADING_SLEW_DPS = 28;

export const COCKPIT_FORWARD_OFFSET_M = 7;

export const COCKPIT_UP_OFFSET_M = 2.6;

export const COCKPIT_MIN_GROUND_CLEARANCE_M = 12;

export const COCKPIT_VIEW_PITCH_DEG = -4;

export const COCKPIT_CAMERA_UPDATE_MS = 50;

export const COCKPIT_HUD_UPDATE_MS = 100;

export const COCKPIT_CONTEXT_UPDATE_MS = 250;

export const COCKPIT_UTILITY_REC_GAP_PX = 12;

export const COCKPIT_UTILITY_SIGNAL_GAP_PX = 8;

export const COCKPIT_UTILITY_MIN_TOP_PX = 96;

export const COCKPIT_UTILITY_MIN_TOP_RATIO = 0.12;

export const COCKPIT_UTILITY_LAUNCHER_MIN_HEIGHT_PX = 50;

export const COCKPIT_GROUND_PROBE_MS = 500;

export const COCKPIT_GROUND_WAIT_TIMEOUT_MS = 5000;

export const COCKPIT_BRIEF_ROTATE_MS = 9000;

export const COCKPIT_BRIEF_CYCLE_OFF_HELP =
  '每 9 秒自动循环简报页（信号 → 新闻 → 本地）。悬停或聚焦时暂停。实时信号数据仍会持续刷新。';

export const COCKPIT_BRIEF_CYCLE_ON_HELP =
  '停止自动翻页。上一页、下一页以及信号/新闻/本地标签仍可用。';

export const COCKPIT_REGIONAL_REFRESH_MS = 5 * 60_000;

export const COCKPIT_REGIONAL_REFRESH_DISTANCE_M = 25_000;

export const COCKPIT_BRIEF_PAGES = [
  {
    id: 'signals',
    kicker: '实时信号',
    subtitle: '观测 / 标注信号',
    source: '来源事件 · 无合成新闻',
  },
  {
    id: 'news',
    kicker: '区域新闻',
    subtitle: '最新位置匹配报道',
    source: 'GOOGLE NEWS RSS · 位置查询 · 近期',
  },
  {
    id: 'local',
    kicker: '本地信息',
    subtitle: '地点 / 气象 / 位置',
    source: 'NATURAL EARTH · OPEN-METEO · UTC',
  },
];

export function isRenderedOnScreen(element) {
  if (!element) return false;
  for (let node = element; node instanceof Element; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function formatCockpitBriefAge(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'TIME UNKNOWN';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}H AGO` : `${Math.round(hours / 24)}D AGO`;
}

export function formatCockpitWindDirection(value) {
  if (!Number.isFinite(value)) return 'DIR UNKNOWN';
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((value % 360) + 360) % 360;
  return `${labels[Math.round(normalized / 45) % labels.length]} · ${Math.round(normalized)}°`;
}

export function setCockpitRollingValue(
  element,
  text,
  numericValue,
  { circularRange = null, immediate = false } = {},
) {
  if (!element) return;
  const nextText = String(text);
  const previousText = element.dataset.rollingText;
  const previousValue = Number(element.dataset.rollingValue);
  const nowMs = performance.now();
  const lastRollMs = Number(element.dataset.rollingAt);
  if (
    !immediate &&
    previousText !== undefined &&
    previousText !== nextText &&
    Number.isFinite(lastRollMs) &&
    nowMs - lastRollMs < 220
  ) {
    return;
  }
  element.dataset.rollingText = nextText;
  element.dataset.rollingAt = String(nowMs);
  if (Number.isFinite(numericValue))
    element.dataset.rollingValue = String(numericValue);
  else delete element.dataset.rollingValue;
  element.setAttribute('aria-label', nextText);

  if (immediate || previousText === undefined || previousText === nextText) {
    if (
      previousText !== nextText ||
      !element.querySelector('.cockpit-roll-token')
    ) {
      element.replaceChildren(
        ...Array.from(nextText, (character) => {
          const token = document.createElement('span');
          token.className = 'cockpit-roll-token';
          token.setAttribute('aria-hidden', 'true');
          token.textContent = character;
          return token;
        }),
      );
    }
    return;
  }

  let delta =
    Number.isFinite(numericValue) && Number.isFinite(previousValue)
      ? numericValue - previousValue
      : 0;
  if (Number.isFinite(circularRange) && circularRange > 0) {
    const halfRange = circularRange / 2;
    if (delta > halfRange) delta -= circularRange;
    else if (delta < -halfRange) delta += circularRange;
  }
  const direction = delta < 0 ? 'down' : 'up';
  const width = Math.max(previousText.length, nextText.length);
  const from = previousText.padStart(width, ' ');
  const to = nextText.padStart(width, ' ');
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < width; index += 1) {
    const previousCharacter = from[index];
    const nextCharacter = to[index];
    const token = document.createElement('span');
    token.className = 'cockpit-roll-token';
    token.setAttribute('aria-hidden', 'true');

    if (
      previousCharacter === nextCharacter ||
      !/\d/.test(previousCharacter) ||
      !/\d/.test(nextCharacter)
    ) {
      token.textContent = nextCharacter === ' ' ? '\u00a0' : nextCharacter;
      fragment.append(token);
      continue;
    }

    token.classList.add('is-rolling', `roll-${direction}`);
    const track = document.createElement('span');
    track.className = 'cockpit-roll-track';
    const first = document.createElement('span');
    const second = document.createElement('span');
    first.textContent = direction === 'up' ? previousCharacter : nextCharacter;
    second.textContent = direction === 'up' ? nextCharacter : previousCharacter;
    track.append(first, second);
    token.append(track);
    fragment.append(token);
  }

  element.replaceChildren(fragment);
}
