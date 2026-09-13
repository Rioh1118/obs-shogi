import {
  evaluationToPercentage,
  type ConvertedMove,
} from "@/widgets/analysis-pane/lib/sfenConverter";
import MoveSequence from "./MoveSequence";
import EvaluationBar from "./EvaluationBar";
import "./BestMoveSection.scss";
import type { Evaluation } from "@/entities/engine";

interface BestMoveSectionProps {
  bestMove: ConvertedMove[] | null;
  evaluation: Evaluation | null;
  /**
   * 評価値バーを出すか。**既定は出さない**（ADR-0010 決定4）。
   *
   * 目盛が ±3000 の線形で勝率と対応しないので、隣に出ている数字より読める情報が無い。
   * 出す・出さないを選べるようにして実装は残す —— 参照が0になると
   * `ratchet:knip` が落ちるうえ、勝率の目盛に描き直す道も閉じる
   */
  showEvaluationBar: boolean;
}

function BestMoveSection({ bestMove, evaluation, showEvaluationBar }: BestMoveSectionProps) {
  return (
    <section className="best-move-section">
      {showEvaluationBar ? <EvaluationBar percentage={evaluationToPercentage(evaluation)} /> : null}
      {bestMove ? (
        <MoveSequence moves={bestMove} variant="primary" evaluation={evaluation} />
      ) : null}
    </section>
  );
}

export default BestMoveSection;
