/**
 * 指挥中心顶栏：北京时间时钟与数据源状态点。
 * @module ui/commandChrome
 */

const BEIJING_TZ = 'Asia/Shanghai';

function formatBeijingClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} 北京时间`;
}

function isoBeijing(date = new Date()) {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: BEIJING_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `${d}T${t}+08:00`;
}

/**
 * 挂载顶栏时钟。可重复调用；第二次起仍会重置定时器。
 * @returns {{ dispose: () => void }}
 */
export function mountCommandChrome(root = document) {
  const clock = root.querySelector('[data-cs-clock]');
  let timer = 0;

  const tick = () => {
    if (!clock) return;
    const now = new Date();
    clock.textContent = formatBeijingClock(now);
    clock.setAttribute('datetime', isoBeijing(now));
  };

  if (clock) {
    tick();
    timer = window.setInterval(tick, 1000);
  }

  return {
    dispose() {
      if (timer) window.clearInterval(timer);
      timer = 0;
    },
  };
}

/**
 * 更新某个数据源状态点。
 * @param {string} source
 * @param {'ok'|'warn'|'alert'|'offline'} state
 * @param {ParentNode} [root]
 */
export function setCommandSourceState(source, state, root = document) {
  const dot = root.querySelector(`.cs-topbar__dot[data-source="${source}"]`);
  if (dot) dot.setAttribute('data-state', state);
}
