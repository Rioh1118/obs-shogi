import { formatEvaluation } from "@/widgets/analysis-pane/lib/sfenConverter";
import type { FormattedMove } from "@/shared/lib/shogi/moveText";
import "./MoveSequence.scss";
import type { Evaluation } from "@/entities/engine";

interface MoveSequenceProps {
  moves: FormattedMove[];
  evaluation?: Evaluation | null;
}

function MoveSequence({ moves, evaluation }: MoveSequenceProps) {
  return (
    <p className="move-sequence">
      <span className="move-sequence__evaluation">
        {evaluation !== undefined && evaluation !== null ? formatEvaluation(evaluation) : ""}
      </span>
      <span className="move-sequence__pv">
        {moves.map((moveData, index) => (
          <span key={index} className="move-sequence__move">
            {moveData.move}
          </span>
        ))}
      </span>
    </p>
  );
}

export default MoveSequence;
