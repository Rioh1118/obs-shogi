import type { Color as ColorType, ShogiMove, Kind } from "@/types";
import { Color, Shogi } from "shogi.js";

/**
 * 王手判定
 */
export function isInCheck(shogi: Shogi, color: ColorType): boolean {
  return shogi.isCheck(color);
}

/**
 * 特定の手が王手放置になるかチェック
 * SFENを使った状態保存・復元アプローチ
 */
export function wouldBeInCheckAfterMove(
  shogi: Shogi,
  move: ShogiMove,
): boolean {
  try {
    // 現在の局面をSFENで保存
    const currentSfen = shogi.toSFENString();
    const testShogi = new Shogi();
    testShogi.initializeFromSFENString(currentSfen);

    if (move.from) {
      // 移動手の場合
      testShogi.move(move.from.x, move.from.y, move.to.x, move.to.y, false);
    } else {
      // 駒打ちの場合
      testShogi.drop(move.to.x, move.to.y, move.kind!, move.color);
    }

    // 手を指した側の色を判定
    const movingColor =
      move.color ||
      (move.from
        ? testShogi.turn === Color.Black
          ? Color.White
          : Color.Black
        : move.color!);

    return testShogi.isCheck(movingColor);
  } catch {
    return true;
  }
}

/**
 * (二歩チェック): 指定した列に指定した色の歩があるかチェック
 */
export function hasFuInColumn(
  shogi: Shogi,
  column: number,
  color: ColorType,
): boolean {
  for (let y = 1; y <= 9; y++) {
    const piece = shogi.get(column, y);
    if (piece && piece.color === color && piece.kind === "FU") {
      return true;
    }
  }
  return false;
}

/**
 * 歩の駒打ち制約チェック(二歩禁止、1段目禁止)
 */
export function canDropFu(
  shogi: Shogi,
  x: number,
  y: number,
  color: ColorType,
): boolean {
  // 二歩チェック
  if (hasFuInColumn(shogi, x, color)) {
    return false;
  }

  // 1段目禁止チェック
  const prohibitedRow = color === Color.Black ? 1 : 9;
  if (y === prohibitedRow) {
    return false;
  }

  const fuDropMove: ShogiMove = {
    to: { x, y },
    color,
    kind: "FU",
  };

  if (isUchifudume(shogi, fuDropMove)) {
    return false;
  }

  return true;
}

export function canDropKe(x: number, y: number, color: ColorType): boolean {
  const prohibitedRows = color === Color.Black ? [1, 2] : [8, 9];
  return !prohibitedRows.includes(y);
}

export function canDropKy(x: number, y: number, color: ColorType): boolean {
  const prohibitedRow = color === Color.Black ? 1 : 9;
  return y !== prohibitedRow;
}

/**
 * 駒種別の駒打ちチェック
 */
export function canDropPieceAt(
  shogi: Shogi,
  kind: Kind,
  x: number,
  y: number,
  color: ColorType,
): boolean {
  switch (kind) {
    case "FU":
      return canDropFu(shogi, x, y, color);
    case "KE":
      return canDropKe(x, y, color);
    case "KY":
      return canDropKy(x, y, color);
    case "GI":
    case "KI":
    case "KA":
    case "HI":
      return true;
    default:
      return false;
  }
}

/**
 * 成ることができるか
 */
export function canPromote(shogi: Shogi, move: ShogiMove): boolean {
  if (!move.from) return false;

  const piece = shogi.get(move.from.x, move.from.y);
  if (!piece) return false;

  // すでに成駒なら成れない
  const promotableKinds: Kind[] = ["FU", "KY", "KE", "GI", "KA", "HI"];
  if (!promotableKinds.includes(piece.kind)) return false;

  // 敵陣に入るかどうか
  const isBlack = piece.color === Color.Black;
  const enemyZone = isBlack ? [1, 2, 3] : [7, 8, 9];

  return enemyZone.includes(move.from.y) || enemyZone.includes(move.to.y);
}

/**
 * 強制成り判定
 */
export function mustPromote(shogi: Shogi, move: ShogiMove): boolean {
  if (!move.from) return false;

  const piece = shogi.get(move.from.x, move.from.y);
  if (!piece) return false; // 駒うちは成れない

  const isBlack = piece.color === Color.Black;

  if (piece.kind === "FU" || piece.kind === "KY") {
    // 1段目に入ったら強制
    const forcePromoteRow = isBlack ? 1 : 9;
    return move.to.y === forcePromoteRow;
  }

  // 桂の強制成り判定
  if (piece.kind === "KE") {
    // 1,2段目に入ったら強制成り
    const forcePromoteRows = isBlack ? [1, 2] : [8, 9];
    return forcePromoteRows.includes(move.to.y);
  }
  return false;
}

/**
 * 打ち歩詰めかどうかをチェック
 * 歩を打って相手玉を詰ませることは禁止
 */
export function isUchifudume(shogi: Shogi, move: ShogiMove): boolean {
  // 駒打ちでない場合は打ち歩詰めではない
  if (move.from) return false;

  // 歩でない場合は打ち歩詰めではない
  if (move.kind !== "FU") return false;

  try {
    // 歩を打った後の局面をシミュレート
    const currentSfen = shogi.toSFENString();
    const testShogi = new Shogi();
    testShogi.initializeFromSFENString(currentSfen);

    // 歩を打つ
    testShogi.drop(move.to.x, move.to.y, move.kind, move.color!);

    // 相手の色を取得
    const opponentColor =
      move.color === Color.Black ? Color.White : Color.Black;

    // 相手が王手されているかチェック
    if (!testShogi.isCheck(opponentColor)) {
      return false;
    }

    // 相手の全ての合法手を取得
    const opponentMoves = getAllPossibleMoves(testShogi, opponentColor);

    // 相手に合法手がない場合は詰み = 打ち歩詰め
    if (opponentMoves.length === 0) {
      return true;
    }

    return false;
  } catch (_) {
    return true; // エラーの場合は安全側に倒して打ち歩詰めとする
  }
}

/**
 * 指定した色の全ての可能な手を取得
 * 王手放置チェックは含む
 */
export function getAllPossibleMoves(
  shogi: Shogi,
  color: ColorType,
): ShogiMove[] {
  const moves: ShogiMove[] = [];

  // 盤上の駒からの移動手
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const piece = shogi.get(x, y);
      if (piece && piece.color === color) {
        const basicMoves = shogi.getMovesFrom(x, y);
        const legalMoves = basicMoves.filter(
          (move) => !wouldBeInCheckAfterMove(shogi, move),
        );
        moves.push(...legalMoves);
      }
    }
  }

  // 持ち駒から打つ
  const hands = shogi.getHandsSummary(color);
  const kinds: Array<"FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI"> = [
    "FU",
    "KY",
    "KE",
    "GI",
    "KI",
    "KA",
    "HI",
  ];

  for (const kind of kinds) {
    if (hands[kind] > 0) {
      const allDrops = shogi.getDropsBy(color);
      const kindDrops = allDrops
        .filter((move) => move.kind === kind)
        .filter((move) =>
          canDropPieceAt(shogi, kind, move.to.x, move.to.y, color),
        )
        .filter((move) => !wouldBeInCheckAfterMove(shogi, move));
      moves.push(...kindDrops);
    }
  }

  return moves;
}
