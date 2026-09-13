import { formatEvaluation, type ConvertedMove } from "@/widgets/analysis-pane/lib/sfenConverter";
import { formatDelta } from "@/widgets/analysis-pane/lib/candidateRows";
import "./MoveSequence.scss";
import type { Evaluation } from "@/entities/engine";

interface MoveSequenceProps {
  moves: ConvertedMove[];
  variant: "primary" | "candidate";
  evaluation?: Evaluation | null;
  /**
   * 最善手との差。**候補にだけ付ける**（最善手の行に `±0` を出しても何も言わない）。
   *
   * `undefined` なら欄ごと出さない。`null`（詰みが混ざって引けない）は `—` が出る。
   */
  delta?: number | null;
}

function MoveSequence({ moves, variant, evaluation, delta }: MoveSequenceProps) {
  return (
    <p className={`move-sequence move-sequence__${variant}`}>
      <span className="move-sequence__evaluation">
        {evaluation !== undefined && evaluation !== null ? formatEvaluation(evaluation) : ""}
      </span>
      {/* **欄ごと消さない。** 消すと列が1つずれて、読み筋が評価値の隣へ寄る */}
      <span className="move-sequence__delta">{delta === undefined ? "" : formatDelta(delta)}</span>
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
