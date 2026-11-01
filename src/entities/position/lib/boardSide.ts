const MIN_SIDE = 240;
const MAX_SIDE = 820;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * 盤を載せる枠の内寸から、盤の一辺を決める。
 *
 * 枠の中へ段を足すと、その高さのぶんだけ渡る `height` が減り、盤が小さくなる。
 * 手番の表示を枠の角への重ねで置いているのはこのため（`PositionPreviewPane.scss` の `__turn-tab`）。
 *
 * 余白は2度引かれる。`ResizeObserver` の `contentRect` は padding を含まないのに、
 * 呼び手はそこから枠の padding をもう一度引いて渡す。枠の高さが中身で決まる面
 * （`SfenKifuCreateModal` の `__preview`）では、枠が盤に合わせて縮むのを繰り返し、
 * 一辺が下限まで落ちて止まる。一辺の値は `boardSide.test.ts` の表が固定している。
 */
export function boardSideForFrame(
  content: { width: number; height: number },
  pad: { x: number; y: number },
): number {
  const usable = Math.floor(Math.min(content.width - pad.x, content.height - pad.y));
  return clamp(usable, MIN_SIDE, MAX_SIDE);
}
