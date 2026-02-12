import { formatEvaluation, type ConvertedMove } from "@/utils/sfenConverter";
import React from "react";
import "./MoveSequence.scss";
import type { Evaluation } from "@/commands/engine/types";

interface MoveSequenceProps {
  moves: ConvertedMove[];
  variant: "primary" | "candidate";
  maxMoves?: number;
  evaluation?: Evaluation | null;
}

function MoveSequence({
  moves,
  variant,
  maxMoves,
  evaluation,
}: MoveSequenceProps) {
  const displayMoves = moves.slice(0, maxMoves);

  return (
    <p className={`move-sequence move-sequence__${variant}`}>
      {evaluation !== undefined && evaluation !== null && (
        <span className="move-sequence__evaluation">
          {formatEvaluation(evaluation)}
        </span>
      )}
      {displayMoves.map((moveData, index) => (
        <React.Fragment key={`${index}`}>
          <span className="move-sequence__move">{moveData.move}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

export default MoveSequence;
