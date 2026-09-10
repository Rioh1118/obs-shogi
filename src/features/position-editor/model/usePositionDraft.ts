import { useCallback, useState } from "react";
import type { Color } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import {
  canDropOn,
  canSendToHand,
  dropFromHand,
  handCount,
  moveBetweenHands,
  movePieceOnBoard,
  pieceAt,
  sendToHand,
  type HandKind,
  type Square,
} from "@/entities/position/lib/positionDraft";

/**
 * 掴んでいるもの
 *
 * **どこから掴んだかを持つ。** 駒の種類だけだと、盤から掴んだ駒を離したときに
 * 元の升へ戻せない（盤の駒は掴んだ時点では盤に残したままにしてある）。
 */
export type Held = { from: "square"; sq: Square } | { from: "hand"; kind: HandKind; color: Color };

interface DraftState {
  state: JKFState;
  held: Held | null;
}

/**
 * 組みかけの局面と、掴んでいるもの
 *
 * **1つの `useState` にまとめてある。** 局面と掴んでいるものは必ず対で動く
 * （置いたら離す、離したら局面は変わらない）。別々に持つと、片方だけ更新する
 * 経路が型に現れず、「掴んだままの駒が盤にも駒台にも無い」状態が作れる。
 *
 * 押せる操作は必ず何かを変える。押しても何も起きない組み合わせ（空升を掴む、
 * 駒のある升へ駒台から置く、玉を駒台へ送る）は**押す前に沈める**ので、
 * ここへは来ない。来たときに黙って捨てるのは、沈め忘れを隠すことになる。
 */
export function usePositionDraft(seed: JKFState) {
  const [draft, setDraft] = useState<DraftState>({ state: seed, held: null });

  /** 掴んでいるものを離す。局面は変えない */
  const release = useCallback(() => {
    setDraft((prev) => (prev.held === null ? prev : { ...prev, held: null }));
  }, []);

  /**
   * 盤の升を押した
   *
   * 何も掴んでいなければ掴む。掴んでいれば置く。同じ升をもう一度押したら離す。
   */
  const pressSquare = useCallback((sq: Square) => {
    setDraft((prev) => {
      const { state, held } = prev;

      if (held === null) {
        return pieceAt(state, sq) ? { state, held: { from: "square", sq } } : prev;
      }

      if (held.from === "square") {
        if (held.sq.x === sq.x && held.sq.y === sq.y) return { state, held: null };
        return { state: movePieceOnBoard(state, held.sq, sq), held: null };
      }

      if (!canDropOn(state, sq)) return prev;
      return { state: dropFromHand(state, held.kind, held.color, sq), held: null };
    });
  }, []);

  /**
   * 駒台を押した
   *
   * `kind` は駒台の中の駒を押したときだけ来る。**掴んでいる間は見ない** ——
   * そのときの意味は「この駒台へ置く」なので、どの駒の上を押したかは関係ない。
   */
  const pressStand = useCallback((color: Color, kind: HandKind | null) => {
    setDraft((prev) => {
      const { state, held } = prev;

      if (held === null) {
        if (kind === null || handCount(state, color, kind) === 0) return prev;
        return { state, held: { from: "hand", kind, color } };
      }

      if (held.from === "square") {
        const piece = pieceAt(state, held.sq);
        if (!piece || !canSendToHand(piece)) return prev;
        return { state: sendToHand(state, held.sq, color), held: null };
      }

      if (held.color === color) return { state, held: null };
      return { state: moveBetweenHands(state, held.kind, held.color, color), held: null };
    });
  }, []);

  /** 種を載せ直す。掴んでいるものは落とす */
  const loadSeed = useCallback((next: JKFState) => {
    setDraft({ state: next, held: null });
  }, []);

  return { state: draft.state, held: draft.held, pressSquare, pressStand, release, loadSeed };
}
