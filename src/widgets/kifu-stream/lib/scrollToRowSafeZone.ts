/**
 * 行が表示の上下25%の帯にかかっていたら、帯の境目の近くまで流す。中央の帯に収まっていれば動かさない。
 *
 * @param unit 流す先を揃える刻み。行の高さを渡すと、上端の行が途中で切れない
 */
export function scrollToRowSafeZone(
  scroller: HTMLElement,
  rowEl: HTMLElement,
  behavior: ScrollBehavior,
  unit = 1,
) {
  const viewH = scroller.clientHeight;
  const rowTop = rowEl.offsetTop;
  const rowH = rowEl.offsetHeight;

  const scrollTop = scroller.scrollTop;
  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewH;

  const safeMargin = Math.round(viewH * 0.25);

  const lookAhead = Math.min(24, Math.round(rowH * 0.4));

  const safeTop = viewTop + safeMargin;
  const safeBottom = viewBottom - safeMargin;

  const rowBottom = rowTop + rowH;

  let target: number | null = null;

  if (rowTop < safeTop) {
    target = rowTop - safeMargin + lookAhead;
  } else if (rowBottom > safeBottom) {
    target = rowBottom - (viewH - safeMargin) - lookAhead;
  }

  if (target == null) return;

  const max = scroller.scrollHeight - viewH;
  const snapped = Math.round(target / unit) * unit;
  scroller.scrollTo({ top: Math.max(0, Math.min(max, snapped)), behavior });
}
