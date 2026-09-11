import type { Color } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import {
  HAND_KINDS,
  canDropOn,
  canSendToHand,
  handCount,
  pieceAt,
  type Square,
} from "@/entities/position/lib/positionDraft";
import type { Held } from "../model/types";

/**
 * 押す前に見せるための印
 *
 * **この面には戻す口が無い**（Undo を持たない）。駒に駒を重ねると1手で駒台へ飛び、
 * 戻すには2手かかる。だから「押したらどうなるか」を押す前に出す。
 *
 * 判定を画面から離してあるのは、`held` と局面の組み合わせが8通りあり、
 * DOM を通して確かめると組み合わせのどれを見ているのか読めなくなるため。
 */

interface SquareMark {
  /** 押しても何も起きない升。**押す前に沈める** */
  blocked: boolean;
  /** ここに重ねると、そこの駒が駒台へ飛ぶ */
  takes: boolean;
  /** ここに重ねると、2つの升が入れ替わる（玉は駒台に載らない） */
  swaps: boolean;
}

interface StandMark {
  /** 掴んでいる駒の置き場として名乗る */
  drop: boolean;
  /**
   * 押しても何も起きない駒台。**押す前に沈める**
   *
   * 升側の `SquareMark.blocked` と同じ概念なので同じ綴りにする ——
   * `drop` の否定ではない（何も掴まずに駒のある駒台を見ると両方 `false`）。
   */
  blocked: boolean;
  /** 重ねたときに駒が飛んでくる先 */
  dest: boolean;
}

const isSameSquare = (a: Square, b: Square): boolean => a.x === b.x && a.y === b.y;

/** 掴んでいる盤の駒と、ホバーしている升にある駒。予告はこの2つが揃ったときだけ出す */
function overlapPreview(
  state: JKFState,
  held: Held | null,
  hovered: Square | null,
): { moving: Color; target: Square; swaps: boolean } | null {
  if (held?.from !== "square" || hovered === null) return null;
  if (isSameSquare(held.sq, hovered)) return null;

  const moving = pieceAt(state, held.sq);
  const there = pieceAt(state, hovered);
  if (!moving || !there) return null;

  return { moving: moving.color, target: hovered, swaps: !canSendToHand(there) };
}

export function squareMark(
  state: JKFState,
  held: Held | null,
  hovered: Square | null,
  sq: Square,
): SquareMark {
  const preview = overlapPreview(state, held, hovered);
  const swaps =
    preview !== null &&
    preview.swaps &&
    (isSameSquare(preview.target, sq) || (held?.from === "square" && isSameSquare(held.sq, sq)));

  return {
    // 掴んでいないときは空升、駒台の駒を掴んでいるときは駒のある升が押せない。
    // 盤の駒を掴んでいるときに押せない升は無い（空升へは動き、駒には重なる）
    blocked:
      held === null ? pieceAt(state, sq) === null : held.from === "hand" && !canDropOn(state, sq),
    takes: preview !== null && !preview.swaps && isSameSquare(preview.target, sq),
    swaps,
  };
}

export function standMark(
  state: JKFState,
  held: Held | null,
  hovered: Square | null,
  color: Color,
): StandMark {
  const preview = overlapPreview(state, held, hovered);
  const dest = preview !== null && !preview.swaps && preview.moving === color;

  if (held === null) {
    // 掴んでいない駒台は「掴む場所」であって置き場ではない。空なら掴むものも無い
    const empty = HAND_KINDS.every((kind) => handCount(state, color, kind) === 0);
    return { drop: false, blocked: empty, dest };
  }

  if (held.from === "square") {
    const piece = pieceAt(state, held.sq);
    const sendable = piece !== null && canSendToHand(piece);
    return { drop: sendable, blocked: !sendable, dest };
  }

  // 駒台の駒は、同じ駒台なら離す・反対の駒台なら移す。どちらも何かが起きる
  return { drop: true, blocked: false, dest };
}
