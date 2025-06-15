import { formatEvaluation, type ConvertedMove } from "@/utils/sfenConverter";
import "./MoveSequence.scss";

interface MoveSequenceProps {
  moves: ConvertedMove[];
  variant: "primary" | "candidate";
  maxMoves?: number;
  evaluation?: number | null;
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
      {displayMoves.map((moveData, index) => (
        <>
          <span
            key={index}
            className={`move-sequence__icon move-sequence__icon--${moveData.isBlack ? "black" : "white"}`}
          ></span>
          <span key={index} className="move-sequence__move">
            {moveData.move}
          </span>
        </>
      ))}
      {evaluation !== undefined && evaluation !== null && (
        <span className="move-sequence__evaluation">
          {formatEvaluation(evaluation)}
        </span>
      )}
    </p>
  );
}

export default MoveSequence;
