import { BOARD_SIZE } from "../model/board";

/** 盤の左上（9一）を0とする升の通し番号を、1始まりの筋と段にする。 */
export function indexToCoords(index: number): { x: number; y: number } {
  const row = Math.floor(index / 9);
  const col = index % 9;

  const x = 9 - col;
  const y = row + 1;

  return { x, y };
}

/**
 * 盤の升を指しているか（1始まり）
 *
 * **整数であることまで見る。** 見ないと `(1.5, 3)` が升として通り、
 * `board[x - 1][y - 1]` が `undefined` を返す経路ができる。盤の外を指したのと
 * 同じ扱いにしたいが、症状は「その升だけ空に見える」になって原因が盤に出ない。
 */
export function isValidCoords(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 1 &&
    x <= BOARD_SIZE.WIDTH &&
    y >= 1 &&
    y <= BOARD_SIZE.HEIGHT
  );
}

/** 筋と段を `7六` の綴りにする。盤の外なら `null` を返す。 */
export function coordsToShogiNotation(x: number, y: number): string | null {
  if (!isValidCoords(x, y)) return null;

  const numberToKanji: Record<number, string> = {
    1: "一",
    2: "二",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "七",
    8: "八",
    9: "九",
  };

  return `${x}${numberToKanji[y]}`;
}
