import { Normalizer } from "json-kifu-format";
import { Piece, Shogi, type Color, type Kind } from "shogi.js";

import { isDeadEnd } from "@/shared/lib/shogi/deadEnd";
import type { ShogiMove } from "../model/types";

function copyPosition(shogi: Shogi): Shogi {
  const copy = new Shogi();
  copy.initializeFromSFENString(shogi.toSFENString());
  return copy;
}

/**
 * 手番の側が `move` を指すと自玉が王手される形になるかを返す。指せない手も `true` を返す。
 *
 * 指す側は `move.color` でなく `shogi.turn` で決める。`shogi.js` の `move` と `drop` は
 * 手番でない側の手を投げるので、`isCheck` に届く手を指したのは必ず手番の側になる。
 * `getMovesFrom` が返す移動手は `color` の欄を持たない。
 */
export function wouldBeInCheckAfterMove(shogi: Shogi, move: ShogiMove): boolean {
  try {
    const played = copyPosition(shogi);

    if (move.from) {
      played.move(move.from.x, move.from.y, move.to.x, move.to.y, false);
    } else {
      played.drop(move.to.x, move.to.y, move.kind!, move.color);
    }

    return played.isCheck(shogi.turn);
  } catch {
    return true;
  }
}

/** (`x`, `y`) の駒の合法な移動を返す。手番でない側の駒は空になる */
export function getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[] {
  return shogi.getMovesFrom(x, y).filter((move) => !wouldBeInCheckAfterMove(shogi, move));
}

/** 移動元か移動先が敵陣なら成れる。指せる手かどうかは見ない */
export function canPromote(shogi: Shogi, move: ShogiMove): boolean {
  if (!move.from) return false;

  const piece = shogi.get(move.from.x, move.from.y);
  if (!piece) return false;

  return (
    Piece.canPromote(piece.kind) &&
    (Normalizer.canPromote(move.from, piece.color) || Normalizer.canPromote(move.to, piece.color))
  );
}

/** 不成では行き所がなくなる手か。指せる手かどうかは見ない */
export function mustPromote(shogi: Shogi, move: ShogiMove): boolean {
  if (!move.from) return false;

  const piece = shogi.get(move.from.x, move.from.y);
  if (!piece) return false;

  return isDeadEnd(piece.kind, piece.color, move.to.y);
}

/** 歩を打って相手玉を詰ませる手かを返す。指せない歩打ちも `true` を返す */
function isUchifudume(shogi: Shogi, move: ShogiMove): boolean {
  if (move.from) return false;
  if (move.kind !== "FU") return false;

  try {
    const played = copyPosition(shogi);
    played.drop(move.to.x, move.to.y, move.kind, move.color!);

    const opponentColor = Piece.oppositeColor(move.color!);

    if (!played.isCheck(opponentColor)) {
      return false;
    }

    // **数え上げてから長さを見ないこと。** この検査は `hasLegalMove` から
    // 呼ばれ、その中でまた歩打ちごとにここへ入る。全部作る形だと入れ子が
    // 掛け算になり、双方が歩を2枚持つ詰み形で1分を超える（実測 66 秒）。
    return !hasLegalMove(played, opponentColor);
  } catch (e) {
    console.log(e);
    return true;
  }
}

/**
 * 指定した色の合法手を、見つかった順に1つずつ返す。
 *
 * ジェネレータなのは数え上げの途中で打ち切るため。王手放置の検査
 * (`wouldBeInCheckAfterMove`) は候補1手ごとに局面を SFEN で写して指し直すので、
 * 「合法手が1つでもあるか」だけを知りたい側（`hasLegalMove`）が
 * 全部を作ると、その分だけ丸ごと無駄になる。
 *
 * **`color` は手番の側であること。** 手番でない側を渡すと、`wouldBeInCheckAfterMove`
 * の中で shogi.js が手番違いを投げ、その catch が「王手放置」に倒すので、
 * 合法手が1つも無いという答えが返る。エラーにはならず、詰みと区別が付かない。
 */
function* generateLegalMoves(shogi: Shogi, color: Color): Generator<ShogiMove> {
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

  yield* filterLegalDrops(shogi, shogi.getDropsBy(color));
}

/**
 * `drops` のうち合法な駒打ちを返す。`drops` は `getDropsBy` の返り値かその部分であること。
 *
 * 二歩と行き所のない升は `getDropsBy` が既に除いているので、残りの2つだけを見る。
 * 駒打ちの合否を決めるのはこの関数だけ。
 *
 * **`wouldBeInCheckAfterMove` を先に見る。** 積の条件なので結果は変わらないが、
 * `isUchifudume` は歩の王手ごとに相手の合法手を数え上げる。王手放置で落ちる歩打ちに
 * その値段を払うと、双方が歩を2枚持つ詰み形で1分を超える（実測 66 秒 → 1ms 未満）。
 */
function* filterLegalDrops(shogi: Shogi, drops: ShogiMove[]): Generator<ShogiMove> {
  for (const move of drops) {
    if (wouldBeInCheckAfterMove(shogi, move)) continue;
    if (isUchifudume(shogi, move)) continue;
    yield move;
  }
}

/** 手番側（`color`）の合法手を全部取得する。前提は `generateLegalMoves` と同じ */
export function getAllLegalMoves(shogi: Shogi, color: Color): ShogiMove[] {
  return [...generateLegalMoves(shogi, color)];
}

/** 手番側（`color`）が `kind` を打てる合法手。前提は `generateLegalMoves` と同じ */
export function getLegalDrops(shogi: Shogi, color: Color, kind: Kind): ShogiMove[] {
  const drops = shogi.getDropsBy(color).filter((move) => move.kind === kind);
  return [...filterLegalDrops(shogi, drops)];
}

/**
 * 手番側（`color`）に合法手が1つでもあるかを返す。前提は `generateLegalMoves` と同じ。
 *
 * 詰みと手詰まりの判定はこれを使う。`getAllLegalMoves(...).length === 0` でも
 * 同じ答えが出るが、詰んでいない局面（対局中はほぼ毎手そうである）でも
 * 最後の1手まで数え上げることになる。
 */
export function hasLegalMove(shogi: Shogi, color: Color): boolean {
  return !generateLegalMoves(shogi, color).next().done;
}
