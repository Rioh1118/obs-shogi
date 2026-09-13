import { useCallback, useMemo, useState } from "react";
import type { Color } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import type { Held } from "./types";
import {
  canDropOn,
  canSendToHand,
  cycleOnBoard,
  dropFromHand,
  flipColor,
  handCount,
  moveBetweenHands,
  movePieceOnBoard,
  pieceAt,
  sendToHand,
  serializeDraft,
  setTurn,
  squareKey,
  type CycleStep,
  type HandKind,
  type Square,
} from "@/entities/position/lib/positionDraft";

interface DraftState {
  state: JKFState;
  held: Held | null;
  /**
   * 升ごとの巡目
   *
   * **消す口を持たない。** `cycleFrom` が升の駒と照合して食い違えば引き継がないので、
   * 駒が動いたあとに残った覚えは黙って無視される。消して回ると、消し忘れた1箇所で
   * 「右クリックしても何も変わらない」が出る（`cycleFrom` の doc に再現がある）。
   */
  cycles: ReadonlyMap<string, CycleStep>;
  /**
   * 種を載せた時点の局面（`serializeDraft` の値）
   *
   * **盤・両駒台・手番だけを見る。** ファイル名や先手名を打っただけで「組みかけ」に
   * なると、閉じるたびに確認が出て、確認そのものが読まれなくなる。
   */
  baseline: string;
}

/**
 * 組みかけの局面と、掴んでいるもの
 *
 * **1つの `useState` にまとめてある。** 局面と掴んでいるものは必ず対で動く
 * （置いたら離す、離したら局面は変わらない）。別々に持つと、片方だけ更新する
 * 経路が型に現れず、「掴んだままの駒が盤にも駒台にも無い」状態が作れる。
 *
 * 押しても何も起きない組み合わせ（空升を掴む、駒のある升へ駒台から置く、
 * 玉を駒台へ送る）は**押す前に沈める**。沈めても押下そのものは届く
 * （沈めているのは見た目と `cursor` で、`onClick` は外していない）ので、
 * ここでも同じ条件を見て `prev` を返す。**二重に見えるが役割が違う** ——
 * 沈めるのは押す前に見せるため、ここは局面を守るため。
 * 見る側を1つにすると、沈め忘れがそのまま「駒が消える／増える」になる。
 */
export function usePositionDraft(makeSeed: () => JKFState) {
  // **種を関数で受ける。** 値で受けると、開くたびに種を組み直す呼び手が
  // レンダーのたびに `Shogi` を1つ作ることになる
  const [draft, setDraft] = useState<DraftState>(() => {
    const seed = makeSeed();
    return { state: seed, held: null, cycles: new Map(), baseline: serializeDraft(seed) };
  });

  /**
   * 種を載せてから盤・両駒台・手番のどれかを変えたか
   *
   * 局面が変わったときだけ数え直す。ポインタを動かすたびに直列化すると、
   * ホバーのたびに81升をなめることになる
   */
  const isDirty = useMemo(
    () => serializeDraft(draft.state) !== draft.baseline,
    [draft.state, draft.baseline],
  );

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
        return pieceAt(state, sq) ? { ...prev, held: { from: "square", sq } } : prev;
      }

      if (held.from === "square") {
        if (held.sq.x === sq.x && held.sq.y === sq.y) return { ...prev, held: null };
        return { ...prev, state: movePieceOnBoard(state, held.sq, sq), held: null };
      }

      if (!canDropOn(state, sq)) return prev;
      return { ...prev, state: dropFromHand(state, held.kind, held.color, sq), held: null };
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
        return { ...prev, held: { from: "hand", kind, color } };
      }

      if (held.from === "square") {
        const piece = pieceAt(state, held.sq);
        if (!piece || !canSendToHand(piece)) return prev;
        return { ...prev, state: sendToHand(state, held.sq, color), held: null };
      }

      if (held.color === color) return { ...prev, held: null };
      return { ...prev, state: moveBetweenHands(state, held.kind, held.color, color), held: null };
    });
  }, []);

  /**
   * 盤の駒を裏返す
   *
   * **掴んでいる駒は離す。** 掴んだまま別の升を裏返せると、次に置いたときに
   * 何が起きるのかを覚えておく必要が出る。
   */
  const flipSquare = useCallback((sq: Square) => {
    setDraft((prev) => {
      if (!pieceAt(prev.state, sq)) return prev;

      const key = squareKey(sq);
      const { state, step } = cycleOnBoard(prev.state, sq, prev.cycles.get(key));
      return { ...prev, state, held: null, cycles: new Map(prev.cycles).set(key, step) };
    });
  }, []);

  /**
   * 手番を入れ替える
   *
   * 掴んでいるものは離さない。手番は盤の外の値で、掴んでいる駒の行き先を変えない。
   */
  const toggleTurn = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      state: setTurn(prev.state, flipColor(prev.state.color)),
    }));
  }, []);

  /**
   * 種を載せ直す。掴んでいるものも覚えていた巡目も落とす
   *
   * `baseline` も置き直すので、載せた直後は組みかけでなくなる。
   */
  const loadSeed = useCallback((next: JKFState) => {
    setDraft({ state: next, held: null, cycles: new Map(), baseline: serializeDraft(next) });
  }, []);

  return {
    state: draft.state,
    held: draft.held,
    pressSquare,
    pressStand,
    flipSquare,
    toggleTurn,
    release,
    loadSeed,
    isDirty,
  };
}
