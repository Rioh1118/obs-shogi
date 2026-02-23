export function scrollToRowSafeZone(
  scroller: HTMLElement,
  rowEl: HTMLElement,
  behavior: ScrollBehavior,
) {
  const viewH = scroller.clientHeight;
  const rowTop = rowEl.offsetTop;
  const rowH = rowEl.offsetHeight;

  const scrollTop = scroller.scrollTop;
  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewH;

  const safeMargin = Math.round(viewH * 0.25);

  const lookAhead = Math.min(24, Math.round(rowH * 0.4)); // 0〜24px 程度

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
  const clamped = Math.max(0, Math.min(max, target));
  scroller.scrollTo({ top: clamped, behavior });
}
