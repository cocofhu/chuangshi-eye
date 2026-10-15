/** Render Radio state without making playback or Context decisions. */
export function renderRadioState(state) {
  if (this.destroyed || !state || !this._radioPanel) return;
  const lifecycle = this.actions.getLifecycle() || null;
  const lifecycleState =
    lifecycle?.lifecycleState || (state.enabled ? 'enabled' : 'disabled');
  state = {
    ...state,
    enabled: lifecycle ? lifecycle.enabled : state.enabled,
    lifecycleState,
    lifecycleUncertain: lifecycle?.uncertain || false,
  };
  this._radioState = state;
  const enabled = Boolean(state.enabled);
  const transitioning =
    lifecycleState === 'enabling' || lifecycleState === 'disabling';
  const uncertain = Boolean(state.lifecycleUncertain);
  const interactive = enabled && !transitioning && !uncertain;
  const selected = state.selected || null;
  const hasStations = state.filteredCount > 0;
  const activePlayback = ['playing', 'buffering'].includes(state.audioState);
  document
    .getElementById('title-bar')
    ?.classList.toggle('radio-broadcasting', state.audioState === 'playing');
  this._radioPanel.classList.toggle('radio-enabled', enabled);
  this._radioPanel.classList.toggle('lifecycle-uncertain', uncertain);
  this._contextRadioDock?.classList.toggle('active', enabled);
  if (this._contextRadioToggleBtn) {
    this._contextRadioToggleBtn.classList.toggle('active', enabled);
  }
  this._syncContextRadioLauncherState();
  this._radioLayerState?.classList.toggle('active', enabled);
  const lifecycleLabel = { enabling: '开启中', disabling: '关闭中' };
  if (this._radioLayerState) {
    this._radioLayerState.textContent = transitioning
      ? lifecycleLabel[lifecycleState] || lifecycleState
      : uncertain
        ? '不确定'
        : state.loading
          ? '同步'
          : enabled
            ? `${state.filteredCount}/${state.stationCount}`
            : '关';
  }
  if (this._radioEnableBtn) {
    this._radioEnableBtn.classList.toggle('active', enabled);
    this._radioEnableBtn.setAttribute('aria-pressed', String(enabled));
    this._radioEnableBtn.textContent = transitioning
      ? lifecycleLabel[lifecycleState] || lifecycleState
      : uncertain
        ? '对齐'
        : enabled
          ? '关闭'
          : '开启';
    this._radioEnableBtn.setAttribute(
      'aria-label',
      uncertain
        ? '对齐电台 — 生命周期不确定'
        : `${enabled ? '关闭' : '开启'}电台`,
    );
    this._radioEnableBtn.disabled = false;
    this._radioEnableBtn.setAttribute('aria-disabled', String(transitioning));
    this._radioEnableBtn.setAttribute('aria-busy', String(transitioning));
  }
  if (this._contextRadioMiniEnableBtn) {
    this._contextRadioMiniEnableBtn.classList.toggle('active', enabled);
    this._contextRadioMiniEnableBtn.setAttribute(
      'aria-pressed',
      String(enabled),
    );
    this._contextRadioMiniEnableBtn.textContent = transitioning
      ? lifecycleLabel[lifecycleState] || lifecycleState
      : uncertain
        ? '对齐'
        : enabled
          ? '关闭'
          : '开启';
    this._contextRadioMiniEnableBtn.setAttribute(
      'aria-label',
      uncertain
        ? '对齐电台 — 生命周期不确定'
        : `${enabled ? '关闭' : '开启'}电台`,
    );
    this._contextRadioMiniEnableBtn.disabled = false;
    this._contextRadioMiniEnableBtn.setAttribute(
      'aria-disabled',
      String(transitioning),
    );
    this._contextRadioMiniEnableBtn.setAttribute(
      'aria-busy',
      String(transitioning),
    );
  }
  if (this._cockpitRadioEnableBtn) {
    this._cockpitRadioEnableBtn.classList.toggle('active', enabled);
    this._cockpitRadioEnableBtn.setAttribute('aria-pressed', String(enabled));
    this._cockpitRadioEnableBtn.textContent = transitioning
      ? lifecycleLabel[lifecycleState] || lifecycleState
      : uncertain
        ? '对齐'
        : enabled
          ? '关闭'
          : '开启';
    this._cockpitRadioEnableBtn.setAttribute(
      'aria-label',
      uncertain
        ? '对齐电台 — 生命周期不确定'
        : `${enabled ? '关闭' : '开启'}电台`,
    );
    this._cockpitRadioEnableBtn.disabled = false;
    this._cockpitRadioEnableBtn.setAttribute(
      'aria-disabled',
      String(transitioning),
    );
    this._cockpitRadioEnableBtn.setAttribute(
      'aria-busy',
      String(transitioning),
    );
  }

  if (this._radioFilter) {
    const prior = state.filter || 'all';
    const categorySignature = state.categories
      .map((category) => `${category.id}:${category.count}:${category.color}`)
      .join('|');
    if (categorySignature !== this._radioCategorySignature) {
      this._radioFilter.replaceChildren(
        ...state.categories.map((category) => {
          const option = document.createElement('option');
          option.value = category.id;
          option.textContent = `● ${category.label} (${category.count})`;
          option.dataset.radioColor = category.color;
          option.style.color = category.color;
          option.setAttribute(
            'aria-label',
            `${category.label} (${category.count})`,
          );
          return option;
        }),
      );
      this._radioCategorySignature = categorySignature;
    }
    this._radioFilter.value = prior;
    const activeCategory = state.categories.find(
      (category) => category.id === prior,
    );
    this._radioFilter.style.color = activeCategory?.color || '';
    this._radioFilter.disabled = !interactive || !state.stationCount;
  }

  const tunerAvailable = interactive && state.filteredCount > 0;
  if (this._radioTuner) this._radioTuner.hidden = !tunerAvailable;
  if (this._radioTunerSlider) this._radioTunerSlider.disabled = !tunerAvailable;
  if (this._radioTunerBandLabel) {
    const activeCategory = state.categories.find(
      (category) => category.id === state.filter,
    );
    this._radioTunerBandLabel.textContent =
      state.filter === 'all'
        ? '目录波段'
        : `${String(activeCategory?.label || state.filter).toUpperCase()} 波段`;
  }
  this._radioTuner?.classList.toggle('is-static', Boolean(state.tuningStatic));
  if (tunerAvailable) this._refreshRadioTunerBand?.();
  if (!tunerAvailable && this._radioTunerDragging) {
    this._radioTunerDragging = false;
    this._radioTunerDragSnapshot = null;
    this._radioTunerStations = [];
    this._radioTuner?.classList.remove('is-static', 'is-dragging');
  }
  if (!tunerAvailable) {
    this._radioTunerStations = [];
    this._radioTunerPool = [];
    this._radioTunerBandSignature = '';
    this._radioTunerSelectedId = null;
  }

  if (this._radioStationName)
    this._radioStationName.textContent =
      selected?.name || '未选择电台';
  if (this._radioStationMeta) {
    const place = selected
      ? [selected.state, selected.countryCode].filter(Boolean).join(' · ')
      : '';
    const signal = selected
      ? [selected.codec, selected.bitrate ? `${selected.bitrate} kbps` : '']
          .filter(Boolean)
          .join(' · ')
      : '';
    this._radioStationMeta.textContent = selected
      ? [place, signal].filter(Boolean).join('  /  ') ||
        '仅目录元数据'
      : state.loading
        ? '正在加载电台目录…'
        : '请选择地球标记或使用下一个。';
  }
  if (this._radioStationTags) {
    const tags = Array.isArray(selected?.tags) ? selected.tags.slice(0, 8) : [];
    this._radioStationTags.textContent = tags.length
      ? `标签 · ${tags.join(' · ')}`
      : '';
  }
  if (this._radioStationHomepage) {
    const homepage = selected?.homepage || '';
    this._radioStationHomepage.hidden = !homepage;
    if (homepage) this._radioStationHomepage.href = homepage;
    else this._radioStationHomepage.removeAttribute('href');
  }

  if (this._radioPrevBtn)
    this._radioPrevBtn.disabled = !interactive || !hasStations;
  if (this._radioNextBtn)
    this._radioNextBtn.disabled = !interactive || !hasStations;
  if (this._contextRadioMiniPrevBtn)
    this._contextRadioMiniPrevBtn.disabled = !interactive || !hasStations;
  if (this._contextRadioMiniNextBtn)
    this._contextRadioMiniNextBtn.disabled = !interactive || !hasStations;
  if (this._cockpitRadioPrevBtn)
    this._cockpitRadioPrevBtn.disabled = !interactive || !hasStations;
  if (this._cockpitRadioNextBtn)
    this._cockpitRadioNextBtn.disabled = !interactive || !hasStations;
  if (this._radioPlayBtn) {
    const action = activePlayback
      ? '暂停'
      : state.audioState === 'paused'
        ? '继续'
        : '播放';
    this._radioPlayBtn.disabled = !interactive || !hasStations;
    this._radioPlayBtn.classList.toggle('active', activePlayback);
    this._radioPlayBtn.textContent = action;
    this._radioPlayBtn.setAttribute(
      'aria-label',
      `${action}${selected ? '所选' : '最近'}电台`,
    );
  }
  if (this._contextRadioMiniPlayBtn) {
    const action = activePlayback
      ? '暂停'
      : state.audioState === 'paused'
        ? '继续'
        : '播放';
    this._contextRadioMiniPlayBtn.disabled = !interactive || !hasStations;
    this._contextRadioMiniPlayBtn.classList.toggle('active', activePlayback);
    this._contextRadioMiniPlayBtn.textContent = activePlayback ? 'Ⅱ' : '▶';
    this._contextRadioMiniPlayBtn.setAttribute(
      'aria-label',
      `${action}${selected ? '所选' : '最近'}电台`,
    );
    this._contextRadioMiniPlayBtn.title = action;
  }
  if (this._cockpitRadioPlayBtn) {
    const action = activePlayback
      ? '暂停'
      : state.audioState === 'paused'
        ? '继续'
        : '播放';
    this._cockpitRadioPlayBtn.disabled = !interactive || !hasStations;
    this._cockpitRadioPlayBtn.classList.toggle('active', activePlayback);
    this._cockpitRadioPlayBtn.textContent = activePlayback ? 'Ⅱ' : '▶';
    this._cockpitRadioPlayBtn.setAttribute(
      'aria-label',
      `${action}${selected ? '所选' : '最近'}电台`,
    );
    this._cockpitRadioPlayBtn.title = action;
  }
  if (this._radioStopBtn)
    this._radioStopBtn.disabled =
      !interactive || state.audioState === 'stopped';
  if (this._radioVolume) this._radioVolume.disabled = !interactive;
  if (this._radioVolume && document.activeElement !== this._radioVolume) {
    this._radioVolume.value = String(Math.round(state.volume * 100));
    if (this._radioVolumeValue)
      this._radioVolumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  }
  if (
    this._contextRadioMiniVolume &&
    document.activeElement !== this._contextRadioMiniVolume
  ) {
    this._contextRadioMiniVolume.value = String(Math.round(state.volume * 100));
  }
  if (this._contextRadioMiniVolume)
    this._contextRadioMiniVolume.disabled = !interactive;
  if (this._contextRadioMiniVolumeValue) {
    this._contextRadioMiniVolumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  }
  if (
    this._cockpitRadioVolume &&
    document.activeElement !== this._cockpitRadioVolume
  ) {
    this._cockpitRadioVolume.value = String(Math.round(state.volume * 100));
  }
  if (this._cockpitRadioVolume)
    this._cockpitRadioVolume.disabled = !interactive;
  if (this._cockpitRadioVolumeValue) {
    this._cockpitRadioVolumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  }
  if (this._contextRadioMiniStation) {
    this._contextRadioMiniStation.textContent = uncertain
      ? '电台状态不确定'
      : selected?.name || (state.loading ? '正在同步目录' : '电台就绪');
  }
  if (this._cockpitRadioStation) {
    this._cockpitRadioStation.textContent = uncertain
      ? '不确定'
      : selected?.name || (state.loading ? '同步中' : '就绪');
  }
  if (this._radioPlaybackState) {
    const catalogSuffix = state.degraded
      ? state.stale
        ? ' · 目录陈旧/降级'
        : ' · 目录降级'
      : state.stale
        ? ' · 目录陈旧'
        : '';
    const outsideFilter =
      selected && state.selectedIndex < 0 ? ' · 不在当前筛选内' : '';
    const messages = {
      stopped: enabled
        ? '就绪 — 仅在你操作后开始播放'
        : '电台关闭',
      loading: '正在直连广播源…',
      buffering: '正在缓冲广播流…',
      playing: `正在播放 ${selected?.name || '电台'}`,
      paused: `已暂停 ${selected?.name || '电台'}`,
      error: state.audioError || '广播流不可用',
    };
    const voiceSuffix = state.voiceDucked
      ? ' · 语音交互期间已静音'
      : state.voiceRestoring
        ? ' · 语音结束后恢复音量'
        : '';
    const tuningSuffix = state.tuningAwaitingStationId
      ? state.audioState === 'error'
        ? ' · 静音表示广播源无音频'
        : ' · 调谐中，等待广播源开始'
      : '';
    const unavailable = state.tuningUnavailableStationId
      ? '目录刷新后电台不可用 — 请选择其他频道'
      : null;
    const lifecycleMessage = transitioning
      ? lifecycleState === 'enabling'
        ? '正在开启电台…'
        : '正在关闭电台…'
      : null;
    const uncertainMessage = uncertain
      ? '电台生命周期不确定 — 请用开启或关闭对齐'
      : null;
    this._radioPlaybackState.textContent = `${uncertainMessage || unavailable || lifecycleMessage || state.error || messages[state.audioState] || '就绪'}${tuningSuffix}${voiceSuffix}${catalogSuffix}${outsideFilter}`;
    this._radioPlaybackState.classList.toggle(
      'error',
      Boolean(
        uncertainMessage ||
        unavailable ||
        state.error ||
        state.audioState === 'error',
      ),
    );
  }
  if (
    !enabled &&
    !transitioning &&
    !this.actions.preservePanelStateDuringClear() &&
    !this._radioPanel.classList.contains('collapsed')
  ) {
    this.actions.setPanelCollapsed('radio-panel', true);
  }
  this.actions.scheduleLayout();
}
