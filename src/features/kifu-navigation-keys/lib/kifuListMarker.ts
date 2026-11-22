/**
 * 棋譜の一覧を指す目印。一覧（`KifuStreamList`）が付け、この feature が読む。
 *
 * 綴りを2箇所に書くと、片方だけ変えても型でもレンダでも落ちない。
 * 一覧の上の ↑ ↓ と、矢印で動かしたときのフォーカスの移動が、例外もエラー表示も無く止まる。
 */
const NAME = "data-kifu-list";

/** 一覧の要素に付ける。`<div {...kifuListMarker}>` */
export const kifuListMarker = { [NAME]: "true" } as const;

/** 一覧の中かを問う CSS セレクタ */
export const KIFU_LIST_SELECTOR = `[${NAME}]`;

/** 棋譜の一覧へフォーカスを移す。一覧が描かれていなければ何もしない */
export function focusKifuList(): void {
  document.querySelector<HTMLElement>(KIFU_LIST_SELECTOR)?.focus({ preventScroll: true });
}
