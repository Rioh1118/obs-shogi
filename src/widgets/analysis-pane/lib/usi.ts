import type {
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
} from "@/entities/engine/api/rust-types";
import { Color } from "shogi.js";

export function convertEvaluationToSenteView(
  evaluation: Evaluation | null | undefined,
  currentTurn: Color | null,
): Evaluation | null {
  if (!evaluation) return null;
  if (currentTurn === null) return evaluation;

  // 先手番ならそのまま、後手番なら符号反転
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
        kind: { MateUnknown: !kind.MateUnknown }, // '+' <-> '-' を反転
      };
    }
  }

  return { ...evaluation, value: -evaluation.value };
}

export function convertCandidateToSenteView(
  candidate: AnalysisCandidate,
  currentTurn: Color | null,
): AnalysisCandidate {
  return {
    ...candidate,
    evaluation: convertEvaluationToSenteView(
      candidate.evaluation ?? null,
      currentTurn,
    ),
  };
}
