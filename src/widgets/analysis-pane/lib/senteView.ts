import type { AnalysisCandidate, Evaluation, EvaluationKind } from "@/entities/engine";
import { Color } from "shogi.js";

/**
 * 手番の側から見た評価値を、先手から見た値にする。
 *
 * エンジンは手番の側から見た値を返す。揃えないと、後手番の局面だけ符号が逆に読める。
 */
function convertEvaluationToSenteView(
  evaluation: Evaluation | null | undefined,
  currentTurn: Color | null,
): Evaluation | null {
  if (!evaluation) return null;
  if (currentTurn === null) return evaluation;

  const shouldFlip = currentTurn !== Color.Black;
  if (!shouldFlip) return evaluation;

  const kind = evaluation.kind as EvaluationKind;

  if (kind === "Centipawn") {
    return { ...evaluation, value: -evaluation.value };
  }

  if (typeof kind === "object" && kind) {
    if ("MateInMoves" in kind) {
      return {
        ...evaluation,
        value: -evaluation.value,
        kind: { MateInMoves: -kind.MateInMoves },
      };
    }
    if ("MateUnknown" in kind) {
      return {
        ...evaluation,
        value: -evaluation.value,
        kind: { MateUnknown: !kind.MateUnknown },
      };
    }
  }

  return { ...evaluation, value: -evaluation.value };
}

/** 候補手の評価値を先手から見た値にする。他の欄はそのまま */
export function convertCandidateToSenteView(
  candidate: AnalysisCandidate,
  currentTurn: Color | null,
): AnalysisCandidate {
  return {
    ...candidate,
    evaluation: convertEvaluationToSenteView(candidate.evaluation ?? null, currentTurn),
  };
}
