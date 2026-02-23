import {
  evaluationToPercentage,
  type ConvertedMove,
} from "@/widgets/analysis-pane/lib/sfenConverter";
import MoveSequence from "./MoveSequence";
import EvaluationBar from "./EvaluationBar";
import "./BestMoveSection.scss";
import type { Evaluation } from "@/entities/engine/api/rust-types";

interface BestMoveSectionProps {
  bestMove: ConvertedMove[] | null;
  evaluation: Evaluation | null;
}

function BestMoveSection({ bestMove, evaluation }: BestMoveSectionProps) {
  return (
    <section className="best-move-section">
      <EvaluationBar percentage={evaluationToPercentage(evaluation)} />
      {bestMove ? (
        <MoveSequence
          moves={bestMove}
          variant="primary"
          evaluation={evaluation}
        />
      ) : null}
    </section>
  );
}

export default BestMoveSection;
