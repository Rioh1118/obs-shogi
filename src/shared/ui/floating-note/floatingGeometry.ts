export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** 利用者が動かした後の位置と大きさ */
export type Geometry = { top: number; left: number; width: number; height: number };

export type AnchoredPos = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

type Offset = { dx: number; dy: number };

const VIEWPORT_MARGIN = 4;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 付箋を置いてよい上端（px）。タイトルバーと、その下に並ぶ帯（`--notice-bands-h`、`--update-band-h`）の下端。
 *
 * 付箋はタイトルバーより下に重なる。帯の上に置くと見出しと閉じるボタンが隠れ、
 * 閉じるボタンの位置を押すと帯のボタンが押される
 */
export function topBandsBottom(): number {
  const bar = document.querySelector(".titlebar")?.getBoundingClientRect().bottom ?? 0;
  const root = getComputedStyle(document.documentElement);
  const band = (name: string) => Number.parseFloat(root.getPropertyValue(name)) || 0;
  return bar + band("--notice-bands-h") + band("--update-band-h");
}

/** 開いた要素の下に置き、下に収まらず上の方が広ければ上に置く。`ceiling` より上には置かない */
export function computeAnchoredPos(
  anchorEl: HTMLElement,
  width: number,
  ceiling = topBandsBottom(),
): AnchoredPos {
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = 8;

  const w = Math.min(width, vw - margin * 2);
  const left = clamp(rect.left, margin, Math.max(margin, vw - w - margin));

  // 開いた要素は、一覧が流れると画面の外へ出る。付箋は帯の下と画面の下端の間に残す。
  // 外へ出すと、開いたままの付箋が見えず、次の Escape が見えない付箋を閉じる
  const anchorTop = clamp(rect.top, ceiling, vh);
  const anchorBottom = clamp(rect.bottom, ceiling, vh);

  const spaceBelow = vh - anchorBottom - gap - margin;
  const spaceAbove = anchorTop - ceiling - gap - margin;
  const placeBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      left,
      top: anchorBottom + gap,
      maxHeight: Math.max(140, spaceBelow),
      placement: "bottom",
    };
  }

  return {
    left,
    bottom: vh - anchorTop + gap,
    maxHeight: Math.max(140, spaceAbove),
    placement: "top",
  };
}

/** 掴んだ位置からの移動量で動かす。画面の外と、上の帯の上へは出さない（`topBandsBottom`） */
export function moveGeometry(
  start: Geometry,
  { dx, dy }: Offset,
  ceiling = topBandsBottom(),
): Geometry {
  const m = VIEWPORT_MARGIN;
  return {
    ...start,
    top: clamp(start.top + dy, ceiling + m, window.innerHeight - start.height - m),
    left: clamp(start.left + dx, m, window.innerWidth - start.width - m),
  };
}

/** 掴んだ把手の辺だけを動かす。下限より小さくせず、画面の外と上の帯の上へは出さない */
export function resizeGeometry(
  start: Geometry,
  edge: ResizeEdge,
  { dx, dy }: Offset,
  ceiling = topBandsBottom(),
): Geometry {
  const m = VIEWPORT_MARGIN;
  const { top, left, width, height } = start;
  const next = { ...start };

  if (edge.includes("e")) {
    next.width = clamp(width + dx, MIN_WIDTH, window.innerWidth - left - m);
  }
  if (edge.includes("w")) {
    next.left = clamp(left + dx, m, left + width - MIN_WIDTH);
    next.width = left + width - next.left;
  }
  if (edge.includes("s")) {
    next.height = clamp(height + dy, MIN_HEIGHT, window.innerHeight - top - m);
  }
  if (edge.includes("n")) {
    next.top = clamp(top + dy, ceiling + m, top + height - MIN_HEIGHT);
    next.height = top + height - next.top;
  }
  return next;
}
