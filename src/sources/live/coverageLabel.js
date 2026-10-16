/** User-facing coverage text. Provider names and other phrases stay as given. */
export function paintedFeedCoverage(coverage) {
  const text = String(coverage ?? '').trim();
  if (!text) return '';
  if (text === 'worldwide upstream snapshot') return '全球上游快照';
  if (text === 'military upstream snapshot') return '军用上游快照';
  const regional = text.match(/^(\d+)\s*nm regional(?: fallback)?$/i);
  if (regional) return `${regional[1]} nm 区域回退`;
  return text;
}
