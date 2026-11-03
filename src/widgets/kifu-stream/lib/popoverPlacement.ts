/** 面の大きさか、画面の大きさ */
type Size = { width: number; height: number };

/** 面を置く基準の矩形。`getBoundingClientRect` の値をそのまま渡せる */
type AnchorRect = Pick<DOMRect, "top" | "left" | "right" | "bottom" | "height">;

/** 横に置いた面の位置。`side` は面が基準のどちら側に出たか */
export type BesidePlacement = { top: number; left: number; side: "right" | "left" };

/** 画面の端から空ける幅 */
const MARGIN = 8;
/** 横に置くとき、基準の矩形から空ける幅 */
const SIDE_GAP = 8;
/** 下か上に置くとき、基準の矩形から空ける幅 */
const DROP_GAP = 6;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * 基準の矩形の右に面を置く位置を返す。右に入らなければ左へ反転し、縦は基準の中心に合わせる。
 *
 * どちらの向きでも、最後に画面の端から `MARGIN` の内側へ寄せる。
 * 行の操作と分岐の操作は、同じ行の横に出る面なので、この1つを共有する。
 */
export function placeBeside(anchor: AnchorRect, pop: Size, viewport: Size): BesidePlacement {
  let side: BesidePlacement["side"] = "right";
  let left = anchor.right + SIDE_GAP;
  if (left + pop.width + MARGIN > viewport.width) {
    side = "left";
    left = anchor.left - pop.width - SIDE_GAP;
  }

  const centeredTop = anchor.top + anchor.height / 2 - pop.height / 2;
  return {
    top: clamp(centeredTop, MARGIN, viewport.height - pop.height - MARGIN),
    left: clamp(left, MARGIN, viewport.width - pop.width - MARGIN),
    side,
  };
}

/**
 * 基準の矩形の下に、右端を揃えて面を置く位置を返す。下に入らなければ上へ、
 * どちらにも入らなければ下に置いて画面の内側へ寄せる。
 */
export function placeBelowOrAbove(
  anchor: AnchorRect,
  menu: Size,
  viewport: Size,
): { top: number; left: number } {
  const left = clamp(anchor.right - menu.width, MARGIN, viewport.width - menu.width - MARGIN);

  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;

  let top: number;
  if (spaceBelow >= menu.height + MARGIN) {
    top = anchor.bottom + DROP_GAP;
  } else if (spaceAbove >= menu.height + MARGIN) {
    top = anchor.top - menu.height - DROP_GAP;
  } else {
    top = clamp(anchor.bottom + DROP_GAP, MARGIN, viewport.height - menu.height - MARGIN);
  }

  return { top, left };
}
