/**
 * 盤の一辺を、盤を載せる枠の内寸から決める。
 *
 * **枠に入れたものは一辺を削る。** 入力は枠の内寸なので、枠の中へ段を1つ足せば
 * その高さのぶんだけここへ渡る `height` が減り、盤が小さくなる。手番の札を
 * 段でなく枠の角への重ねで置いているのはこのため（`PositionPreviewPane.scss` の
 * `__turn-tab`）。
 *
 * **余白を2度引く。** `ResizeObserver` が渡す `contentRect` には既に padding が
 * 入っていないのに、呼び手はそこから枠の padding をもう一度引いて渡す。
 * **枠の高さが中身で決まる面（`SfenKifuCreateModal` の `__preview` は高さを
 * 持たない flex）では、これが効いて一辺が下限へ落ちる** —— 枠が盤に合わせて縮み、
 * 縮んだ枠を測り直すことを繰り返すため。下限に着いたところで止まる。
 */
const MIN_SIDE = 240;
const MAX_SIDE = 820;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function boardSideForFrame(
  content: { width: number; height: number },
  pad: { x: number; y: number },
): number {
  const usable = Math.floor(Math.min(content.width - pad.x, content.height - pad.y));
  return clamp(usable, MIN_SIDE, MAX_SIDE);
}
