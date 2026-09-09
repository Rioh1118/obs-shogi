import { Color, Shogi, type Kind } from "shogi.js";
import type { ShogiMove } from "../model/types";

/**
 * 王手判定
 */
export function isInCheck(shogi: Shogi, color: Color): boolean {
  return shogi.isCheck(color);
}

/**
 * 特定の手が王手放置になるかチェック
 * SFENを使った状態保存・復元アプローチ
 */
export function wouldBeInCheckAfterMove(shogi: Shogi, move: ShogiMove): boolean {
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
      (move.from ? (testShogi.turn === Color.Black ? Color.White : Color.Black) : move.color!);

    return testShogi.isCheck(movingColor);
  } catch {
    return true;
  }
}

/**
 * (二歩チェック): 指定した列に指定した色の歩があるかチェック
 */
export function hasFuInColumn(shogi: Shogi, column: number, color: Color): boolean {
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
export function canDropFu(shogi: Shogi, x: number, y: number, color: Color): boolean {
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

export function canDropKe(_x: number, y: number, color: Color): boolean {
  const prohibitedRows = color === Color.Black ? [1, 2] : [8, 9];
  return !prohibitedRows.includes(y);
}

export function canDropKy(_x: number, y: number, color: Color): boolean {
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
  color: Color,
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
    const opponentColor = move.color === Color.Black ? Color.White : Color.Black;

    // 相手が王手されているかチェック
    if (!testShogi.isCheck(opponentColor)) {
      return false;
    }

    // 相手に合法手がない場合は詰み = 打ち歩詰め。
    //
    // **数え上げてから長さを見ないこと。** この検査は `hasLegalMove` から
    // 呼ばれ、その中でまた歩打ちごとにここへ入る。全部作る形だと入れ子が
    // 掛け算になり、双方が歩を2枚持つ詰み形で1分を超える（実測 66 秒）。
    return !hasLegalMove(testShogi, opponentColor);
  } catch (e) {
    console.log(e);
    return true; // エラーの場合は安全側に倒して打ち歩詰めとする
  }
}

/**
 * 指定した色の合法手を、見つかった順に1つずつ返す
 *
 * **数え上げの途中で打ち切れるようにするための形。** 王手放置の検査
 * (`wouldBeInCheckAfterMove`) は候補1手ごとに局面を SFEN で写して指し直すので、
 * 「合法手が1つでもあるか」だけを知りたい側（`hasLegalMove`）が
 * 全部を作ると、その分だけ丸ごと無駄になる。
 *
 * **`color` は手番の側であること。** 手番でない側を渡すと、`wouldBeInCheckAfterMove`
 * の中で shogi.js が手番違いを投げ、その catch が「王手放置」に倒すので、
 * **合法手が1つも無い＝詰み**という答えが返る。エラーにはならない。
 */
function* generateLegalMoves(shogi: Shogi, color: Color): Generator<ShogiMove> {
  // 盤上の駒からの移動手
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const piece = shogi.get(x, y);
      if (piece && piece.color === color) {
        for (const move of shogi.getMovesFrom(x, y)) {
          if (!wouldBeInCheckAfterMove(shogi, move)) yield move;
        }
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

  const allDrops = shogi.getDropsBy(color);
  for (const kind of kinds) {
    if (hands[kind] === 0) continue;
    for (const move of allDrops) {
      if (move.kind !== kind) continue;
      // **`wouldBeInCheckAfterMove` を先に見る。** 積の条件なので結果は変わらないが、
      // `canDropPieceAt` は歩について `isUchifudume` を通り、その中で相手の合法手を
      // また数え上げる。王手放置で落ちる歩打ちにその値段を払うと、双方が歩を2枚持つ
      // 詰み形で1分を超える（実測 66 秒 → 1ms 未満）
      if (wouldBeInCheckAfterMove(shogi, move)) continue;
      if (!canDropPieceAt(shogi, kind, move.to.x, move.to.y, color)) continue;
      yield move;
    }
  }
}

/** 手番側（`color`）の合法手を全部取得する。前提は `generateLegalMoves` と同じ */
export function getAllLegalMoves(shogi: Shogi, color: Color): ShogiMove[] {
  return [...generateLegalMoves(shogi, color)];
}

/**
 * 合法手が1つでもあるか
 *
 * **詰み・手詰まりの判定はこれを使う。** `getAllLegalMoves(...).length === 0` でも
 * 同じ答えが出るが、詰んでいない局面（対局中はほぼ毎手そうである）でも
 * 最後の1手まで数え上げることになる。前提は `generateLegalMoves` と同じ。
 */
export function hasLegalMove(shogi: Shogi, color: Color): boolean {
  return !generateLegalMoves(shogi, color).next().done;
}
