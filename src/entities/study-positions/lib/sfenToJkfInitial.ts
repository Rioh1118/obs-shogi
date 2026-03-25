import { Shogi } from "shogi.js";
import { isRawKind, type Kind, type RawKind } from "shogi.js/cjs/Kind";
import type { JKFHand, JKFPiece, JKFState } from "@/entities/kifu/model/jkf";
import type { Piece } from "shogi.js";

const RAW_KINDS: RawKind[] = ["FU", "KY", "KE", "GI", "KI", "KA", "HI"];

function emptyHand(): JKFHand {
  return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
}

function toRawKind(kind: Kind): RawKind {
  return isRawKind(kind) ? kind : (kind as RawKind);
}

/**
 * SFEN 文字列から JKF の initial.data (IStateFormat) を生成する。
 * shogi.js で盤面を復元し、board / hands / color を JKF 形式に変換する。
 */
export function sfenToJkfInitial(sfen: string): { preset: "OTHER"; data: JKFState } | null {
  try {
    const shogi = new Shogi();
    shogi.initializeFromSFENString(sfen);

    // board: Piece[][] → JKFPiece[][] (board[x-1][y-1])
    const board: JKFPiece[][] = [];
    for (let x = 0; x < 9; x++) {
      const col: JKFPiece[] = [];
      for (let y = 0; y < 9; y++) {
        const piece: Piece | null = shogi.board[x]?.[y] ?? null;
        if (piece && piece.kind != null && piece.color != null) {
          col.push({ color: piece.color as 0 | 1, kind: piece.kind });
        } else {
          col.push({});
        }
      }
      board.push(col);
    }

    // hands: Piece[][] → [JKFHand, JKFHand]
    const hands: [JKFHand, JKFHand] = [emptyHand(), emptyHand()];
    for (const c of [0, 1] as const) {
      const handPieces = shogi.hands?.[c] ?? [];
      for (const p of handPieces) {
        if (p && p.kind) {
          const rk = toRawKind(p.kind);
          if (RAW_KINDS.includes(rk)) {
            hands[c][rk] += 1;
          }
        }
      }
    }

    const color = shogi.turn as number as 0 | 1;

    return {
      preset: "OTHER",
      data: { color, board, hands },
    };
  } catch (e) {
    console.warn("[sfenToJkfInitial] failed:", e, sfen);
    return null;
  }
}
