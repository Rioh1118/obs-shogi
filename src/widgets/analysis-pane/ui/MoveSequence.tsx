import {
  formatEvaluation,
  type ConvertedMove,
} from "@/widgets/analysis-pane/lib/sfenConverter";
import "./MoveSequence.scss";
import type { Evaluation } from "@/entities/engine/api/rust-types";

interface MoveSequenceProps {
  moves: ConvertedMove[];
  variant: "primary" | "candidate";
  evaluation?: Evaluation | null;
}

function MoveSequence({ moves, variant, evaluation }: MoveSequenceProps) {
  return (
    <p className={`move-sequence move-sequence__${variant}`}>
      <span className="move-sequence__evaluation">
        {evaluation !== undefined && evaluation !== null
          ? formatEvaluation(evaluation)
          : ""}
      </span>
      <span
        className="move-sequence__pv"
        title={moves.map((m) => m.move).join(" ")}
      >
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
