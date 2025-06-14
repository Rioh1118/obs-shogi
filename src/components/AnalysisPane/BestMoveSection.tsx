import {
  evaluationToPercentage,
  type ConvertedMove,
} from "@/utils/sfenConverter";
import MoveSequence from "./MoveSequence";
import EvaluationBar from "./EvaluationBar";

interface BestMoveSectionProps {
  bestMove: ConvertedMove[] | null;
  evaluation: number | null;
}

function BestMoveSection({ bestMove, evaluation }: BestMoveSectionProps) {
  return (
    <section className="best-move-section">
      {bestMove ? (
        <MoveSequence
          moves={bestMove}
          variant="primary"
          maxMoves={6}
          evaluation={evaluation}
        />
      ) : null}
      <EvaluationBar percentage={evaluationToPercentage(evaluation)} />
    </section>
  );
}

export default BestMoveSection;
