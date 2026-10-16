/** Explain mapped-site availability without claiming an unobserved overload. */
export function installationFeedback(stats = {}, now = Date.now()) {
  const reasons = {
    rate_limited: 'Overpass 限流',
    timeout: 'Overpass 超时',
    query_failed: 'Overpass 查询未完成',
    tiles_unavailable: '地图瓦片暂不可用',
    names_unavailable: '标注名称暂不可用',
  };
  const reason =
    reasons[stats.failureReason] || 'Overpass 暂不可用';
  if (stats.loading)
    return stats.retrying ? '正在重试标注站点…' : '正在获取标注站点…';
  if (stats.retryAt > 0) {
    const seconds = Math.max(0, Math.ceil((stats.retryAt - now) / 1000));
    return `${reason} — ${seconds ? `${seconds} 秒后重试` : '等待重试'}`;
  }
  if (stats.status === 'unavailable') return reason;
  if (stats.status === 'zoom-in')
    return '放大地图以搜索标注站点';
  if (stats.stale) return '显示缓存的标注站点';
  if (stats.status === 'idle') return '标注站点未加载';
  // With a count, say what was found and where; an empty area is not "loaded".
  if (Number.isFinite(stats.count)) {
    const km =
      stats.coverage?.kind === 'subject' &&
      Number.isFinite(stats.coverage.radiusM)
        ? Math.round(stats.coverage.radiusM / 1000)
        : null;
    const where = km ? `（目标周边 ${km} 公里）` : '（视野内）';
    if (stats.count === 0) return `暂无标注站点${where}`;
    return `${stats.count} 个标注站点${where}`;
  }
  return '标注站点已加载';
}
