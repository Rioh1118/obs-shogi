import type { Evaluation } from "@/entities/engine";

/** 評価値を表に出す文字にする。詰みは `Mate+7` のように手数を添える */
export function formatEvaluation(e: Evaluation | null): string {
  if (!e) return "---";

  const k = e.kind;

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

/**
 * 評価値バーの先手の側の幅（0〜100）。
 *
 * ±3000 を線形に写し、外は端で止める。詰みは勝つ側の端へ置く。
 */
export function evaluationToPercentage(e: Evaluation | null): number {
  if (!e) return 50;

  const k = e.kind;

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
