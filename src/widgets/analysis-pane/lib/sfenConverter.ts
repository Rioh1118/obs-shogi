import type {
  Evaluation,
  EvaluationKind,
} from "@/entities/engine/api/rust-types";
import { Color, Record } from "tsshogi";
// 変換後の指し手データ型
export interface ConvertedMove {
  move: string; // 日本語表記（例: "７六歩"）
  isBlack: boolean; // 先手かどうか
}

const normalizeToken = (x: string) => {
  const t = x.trim();

  // JSON文字列っぽいなら JSON.parse で安全に剥がす（\" なども戻る）
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    try {
      // "abc" -> abc
      return JSON.parse(t);
    } catch {
      // JSON.parseできない場合の保険
      return t.slice(1, -1);
    }
  }
  return t;
};

// SFEN手順配列を日本語データ配列に変換
export function convertSfenSequence(
  sfen: string | null,
  sfenMoves: string[],
): ConvertedMove[] {
  if (!sfen) {
    return [];
  }
  const sfenNorm = normalizeToken(sfen);
  const movesNorm = sfenMoves.map(normalizeToken).filter(Boolean);

  const usiString =
    movesNorm.length > 0
      ? `position sfen ${sfenNorm} moves ${movesNorm.join(" ")}`
      : `position sfen ${sfenNorm}`;

  const record = Record.newByUSI(usiString);
  if (record instanceof Error) {
    console.warn("[SFEN_CONVERTER] parse failed", {
      err: String(record),
      sfen: JSON.stringify(sfen),
      moves: sfenMoves.map((m) => JSON.stringify(m)),
      usi: JSON.stringify(usiString),
    });
    return [];
  }

  return record.moves.slice(1).map((move) => ({
    move: move.displayText,
    isBlack: move.prev!.nextColor === Color.BLACK,
  }));
}

export function formatEvaluation(e: Evaluation | null): string {
  if (!e) return "---";

  const k = e.kind as EvaluationKind;

  if (k === "Centipawn") {
    const v = e.value;
    return v > 0 ? `+${v}` : `${v}`;
  }

  if (typeof k === "object" && k) {
    if ("MateInMoves" in k) {
      const n = k.MateInMoves;
      const sign = n >= 0 ? "+" : "-";
      return `Mate${sign}${Math.abs(n)}`;
    }
    if ("MateUnknown" in k) {
      return `Mate${k.MateUnknown ? "+" : "-"}`;
    }
  }

  return `${e.value}`;
}

// 評価値をパーセンテージに変換（評価バー用）
// -3000〜+3000を0〜100%にマッピング、範囲外はクランプ
export function evaluationToPercentage(e: Evaluation | null): number {
  if (!e) return 50;

  const k = e.kind as EvaluationKind;

  if (k === "Centipawn") {
    const v = e.value;
    if (v <= -3000) return 0;
    if (v >= 3000) return 100;
    return ((v + 3000) / 6000) * 100;
  }

  if (typeof k === "object" && k) {
    if ("MateInMoves" in k) {
      return k.MateInMoves >= 0 ? 100 : 0;
    }
    if ("MateUnknown" in k) {
      return k.MateUnknown ? 100 : 0;
    }
  }

  return 50;
}
