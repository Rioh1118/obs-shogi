import { BOARD_SIZE } from "../model/shogi";

// インデックスから座標に変換（1-indexed）
export function indexToCoords(index: number): { x: number; y: number } {
  const row = Math.floor(index / 9);
  const col = index % 9;

  const x = 9 - col;
  const y = row + 1;

  return { x, y };
}

// 座標からインデックスに変換（1-indexed）
export function coordsToArrayIndex(
  x: number,
  y: number,
): { row: number; col: number } {
  return { row: y - 1, col: 9 - x };
}

// 座標が盤面内かチェック
export function isValidCoords(x: number, y: number): boolean {
  return x >= 1 && x <= BOARD_SIZE.WIDTH && y >= 1 && y <= BOARD_SIZE.HEIGHT;
}

// 配列インデックスから座標に変換（0-indexed）
export function arrayIndexToCoords(index: number): { x: number; y: number } {
  const x = index % BOARD_SIZE.WIDTH;
  const y = Math.floor(index / BOARD_SIZE.WIDTH);
  return { x, y };
}

// 将棋の座標表記（9一、8二など）から数値座標に変換
export function shogiNotationToCoords(
  notation: string,
): { x: number; y: number } | null {
  if (notation.length !== 2) return null;

  const xChar = notation[0];
  const yChar = notation[1];

  // 漢数字を数値に変換
  const kanjiToNumber: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  const x = parseInt(xChar);
  const y = kanjiToNumber[yChar];

  if (isNaN(x) || !y || !isValidCoords(x, y)) return null;

  return { x, y };
}

// 数値座標から将棋の座標表記に変換
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

// 2つの座標間の距離を計算
export function getDistance(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return Math.sqrt(dx * dx + dy * dy);
}

// 2つの座標が同じかチェック
export function isSameCoords(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return a.x === b.x && a.y === b.y;
}

// 座標が特定の範囲内かチェック
export function isInRange(
  coord: { x: number; y: number },
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
): boolean {
  return (
    coord.x >= topLeft.x &&
    coord.x <= bottomRight.x &&
    coord.y >= topLeft.y &&
    coord.y <= bottomRight.y
  );
}

// 盤面を180度回転した座標を取得（相手視点）
export function getFlippedCoords(
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: BOARD_SIZE.WIDTH + 1 - x,
    y: BOARD_SIZE.HEIGHT + 1 - y,
  };
}
