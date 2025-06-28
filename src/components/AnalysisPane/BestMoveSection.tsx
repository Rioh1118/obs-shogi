import {
  evaluationToPercentage,
  type ConvertedMove,
} from "@/utils/sfenConverter";
import MoveSequence from "./MoveSequence";
import EvaluationBar from "./EvaluationBar";
import "./BestMoveSection.scss";

interface BestMoveSectionProps {
  bestMove: ConvertedMove[] | null;
  evaluation: number | null;
}

function BestMoveSection({ bestMove, evaluation }: BestMoveSectionProps) {
  return (
    <section className="best-move-section">
      <EvaluationBar percentage={evaluationToPercentage(evaluation)} />
      {bestMove ? (
        <MoveSequence
          moves={bestMove}
          variant="primary"
          maxMoves={13}
          evaluation={evaluation}
        />
      ) : null}
    </section>
  );
}

export default BestMoveSection;
