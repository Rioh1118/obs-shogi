import type { Evaluation, EvaluationKind } from "@/entities/engine";

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
