/**
 * 盤の内側を指す目印。**盤の升と駒台が付け、「盤の外か」の判定が読む。**
 *
 * 付ける側（`Square` / `Hand`）と読む側（`useClearBoardSelection`）は別のファイルに居る。
 * 綴りを2箇所に書くと、片方だけ変えても型でもレンダでも落ちない——
 * **盤の外を押しても選択が外れなくなるだけ**で、例外もエラー表示も出ない。
 * だから綴りはここ1箇所に置き、セレクタもここから組む。
 */
const BOARD_SQUARE = { "data-board-square": "true" } as const;
const HAND_AREA = { "data-hand-area": "true" } as const;

const selectorOf = (marker: Record<string, string>) =>
  Object.entries(marker)
    .map(([name, value]) => `[${name}="${value}"]`)
    .join("");

/** 盤の升に付ける。`<div {...boardSquareMarker}>` */
export const boardSquareMarker = BOARD_SQUARE;

/** 駒台に付ける */
export const handAreaMarker = HAND_AREA;

/** 盤の内側かを問う CSS セレクタ */
export const INSIDE_BOARD_SELECTOR = [BOARD_SQUARE, HAND_AREA].map(selectorOf).join(",");
