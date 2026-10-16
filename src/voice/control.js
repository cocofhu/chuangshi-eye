/** Build the voice control independently of its connection backend. */
export function createVoiceControl({ reset = false } = {}) {
  let root = document.getElementById('gev-voice-control');
  if (root && reset) {
    root.remove();
    root = null;
  }
  if (!root) {
    root = document.createElement('div');
    root.id = 'gev-voice-control';
    root.dataset.status = 'idle';
    root.dataset.speaker = 'idle';
    root.innerHTML = `
      <div class="gev-voice-heading">
        <div class="gev-voice-kicker">语音</div>
        <div id="gev-voice-status">关</div>
        <div class="gev-voice-cost">
          <button id="gev-voice-tier" class="gev-voice-tier-btn" type="button" aria-pressed="false" title="语音模型档位 — 下次会话生效">标准</button>
          <span id="gev-voice-cost-value" class="gev-voice-cost-value" data-level="ok" title="估计会话费用">~$0.00</span>
        </div>
      </div>
      <button id="gev-voice-button" type="button" aria-label="语音控制 — 激活以开关语音；按住空格说话" aria-describedby="gev-voice-help">
        <span class="gev-mic-orbit"><img src="/mic.svg" alt="" /></span>
        <span class="gev-mic-label">语音</span>
      </button>
      <div class="gev-voice-visualizer" aria-hidden="true">
        ${Array.from({ length: 15 }, (_, index) => `<span style="--bar:${index}"></span>`).join('')}
      </div>
      <div class="gev-voice-readout">
        <div id="gev-voice-detail">语音待命</div>
      </div>
      <div id="gev-voice-help" class="gev-voice-help-tray" role="tooltip">
        <span class="gev-voice-help-kicker">语音控制</span>
        <span class="gev-voice-help-detail">按住空格说话 · 点按空格以激活焦点控件</span>
      </div>
      <section id="gev-voice-card" class="gev-voice-card" hidden aria-label="语音助手">
        <div class="gev-voice-card-header">
          <span class="gev-voice-card-kicker">语音</span>
          <span id="gev-voice-card-phase" class="gev-voice-card-phase"></span>
          <button id="gev-voice-card-dismiss" class="gev-voice-card-dismiss" type="button" aria-label="关闭语音卡片">×</button>
        </div>
        <p id="gev-voice-card-user" class="gev-voice-card-caption" data-role="user" hidden><span class="gev-voice-card-who">你</span><span id="gev-voice-card-user-text" class="gev-voice-card-text"></span></p>
        <p id="gev-voice-card-pointer" class="gev-voice-card-pointer" hidden><span id="gev-voice-card-pointer-kind" class="gev-voice-card-who">此</span><span class="gev-voice-card-sr">: </span><span id="gev-voice-card-pointer-text" class="gev-voice-card-pointer-label"></span></p>
        <p id="gev-voice-card-assistant" class="gev-voice-card-caption" data-role="assistant" hidden><span class="gev-voice-card-who">GEV</span><span id="gev-voice-card-assistant-text" class="gev-voice-card-text"></span></p>
        <ol id="gev-voice-card-plan" class="gev-voice-card-plan" aria-label="计划" hidden></ol>
        <div id="gev-voice-card-result" class="gev-voice-card-result" hidden>
          <div id="gev-voice-card-result-title" class="gev-voice-card-result-title"></div>
          <div id="gev-voice-card-chips" class="gev-voice-card-chips" hidden></div>
          <ul id="gev-voice-card-lines" class="gev-voice-card-lines"></ul>
          <ol id="gev-voice-card-referents" class="gev-voice-card-referents" aria-label="引用项" hidden></ol>
          <details id="gev-voice-card-notes" class="gev-voice-card-notes" hidden>
            <summary>备注与来源</summary>
            <ul id="gev-voice-card-note-list" class="gev-voice-card-lines"></ul>
          </details>
        </div>
        <div id="gev-voice-card-live" class="gev-voice-card-sr" aria-live="polite" aria-atomic="true"></div>
      </section>
      <div class="gev-voice-error-tray" role="alert" aria-live="assertive">
        <div class="gev-voice-error-header">
          <span>语音系统错误</span>
          <button class="gev-voice-error-dismiss" type="button">关闭</button>
        </div>
        <div id="gev-voice-error-detail"></div>
        <div class="gev-voice-error-hint">请检查麦克风权限和网络，然后重试。</div>
      </div>
    `;
    const commandDock = document.getElementById('command-dock');
    if (commandDock) {
      const locationBar = document.getElementById('location-bar');
      const controlPanel = document.getElementById('control-panel');
      commandDock.appendChild(root);
      if (locationBar) commandDock.insertBefore(locationBar, root);
      if (controlPanel) commandDock.appendChild(controlPanel);
    } else {
      document.body.appendChild(root);
    }
    root
      .querySelector('.gev-voice-error-dismiss')
      ?.addEventListener('click', () => {
        root.classList.add('error-dismissed');
      });
  }
  return {
    root,
    button: root.querySelector('#gev-voice-button'),
    buttonLabel: root.querySelector('.gev-mic-label'),
    status: root.querySelector('#gev-voice-status'),
    detail: root.querySelector('#gev-voice-detail'),
    helpDetail: root.querySelector('.gev-voice-help-detail'),
    errorDetail: root.querySelector('#gev-voice-error-detail'),
    tierButton: root.querySelector('#gev-voice-tier'),
    costValue: root.querySelector('#gev-voice-cost-value'),
    card: root.querySelector('#gev-voice-card'),
  };
}
