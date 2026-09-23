import "./CandidatesSection.scss";
import MoveSequence from "./MoveSequence";
import type { CandidateRow } from "@/widgets/analysis-pane/lib/candidateRows";
import { EMPTY_CANDIDATES } from "@/widgets/analysis-pane/lib/labels";

interface CandidatesSectionProps {
  /**
   * 出す候補。**最善手も1行目としてここに入る。**
   *
   * 件数はここで切らない —— 上限は `MAX_VISIBLE_CANDIDATES`（`MULTIPV_MAX` から導く）が
   * 組む時点で掛かっている。ここでもう一度切ると、プリセットが増やせる数と
   * 画面が出せる数が独立に決まる。
   */
  rows: readonly CandidateRow[];
}

/**
 * 候補手を1手1行で詰めて出す（表示モード「行」）。
 *
 * **最善手を別の箱にしない。** 箱にすると同じデータが2つの体系で並び、
 * 表の並びと揃わない。最善手は1行目にあることだけで示し、**帯も太さも付けない。**
 * 1手1行で本数を見るモードなので、1行だけ帯と太さで浮かせると詰めた並びの中で雑音になる。
 * 最善の行に印を付けるのは表モード（`candidate-table__row--best`）だけ。
 *
 * **選択は持たない。** 読む位置の印は表モードだけが持つ。
 */
function CandidatesSection({ rows }: CandidatesSectionProps) {
  return (
    <section className="candidates-section">
      {rows.map((row) => (
        <MoveSequence key={row.rank} moves={[...row.moves]} evaluation={row.evaluation} />
      ))}
      {rows.length === 0 && <p className="candidates-section__empty">{EMPTY_CANDIDATES}</p>}
    </section>
  );
}

export default CandidatesSection;
