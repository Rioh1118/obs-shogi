import { Color, Shogi, type Kind } from "shogi.js";
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
 * 手番でない側の手を投げるので、最後の行に着く手を指したのは必ず手番の側で、
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
function isUchifudume(shogi: Shogi, move: ShogiMove): boolean {
  // 駒打ちでない場合は打ち歩詰めではない
  if (move.from) return false;

  // 歩でない場合は打ち歩詰めではない
  if (move.kind !== "FU") return false;

  try {
    // 歩を打った後の局面をシミュレート
    const played = copyPosition(shogi);

    // 歩を打つ
    played.drop(move.to.x, move.to.y, move.kind, move.color!);

    // 相手の色を取得
    const opponentColor = move.color === Color.Black ? Color.White : Color.Black;

    // 相手が王手されているかチェック
    if (!played.isCheck(opponentColor)) {
      return false;
    }

    // 相手に合法手がない場合は詰み = 打ち歩詰め。
    //
    // **数え上げてから長さを見ないこと。** この検査は `hasLegalMove` から
    // 呼ばれ、その中でまた歩打ちごとにここへ入る。全部作る形だと入れ子が
    // 掛け算になり、双方が歩を2枚持つ詰み形で1分を超える（実測 66 秒）。
    return !hasLegalMove(played, opponentColor);
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
 * 合法手が1つでもあるか
 *
 * **詰み・手詰まりの判定はこれを使う。** `getAllLegalMoves(...).length === 0` でも
 * 同じ答えが出るが、詰んでいない局面（対局中はほぼ毎手そうである）でも
 * 最後の1手まで数え上げることになる。前提は `generateLegalMoves` と同じ。
 */
export function hasLegalMove(shogi: Shogi, color: Color): boolean {
  return !generateLegalMoves(shogi, color).next().done;
}
