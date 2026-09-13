import "./CandidatesSection.scss";
import MoveSequence from "./MoveSequence";
import type { CandidateRow } from "@/widgets/analysis-pane/lib/candidateRows";

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
 * 表・詳細のモードと行の並びが揃わない。最善手は1行目で、太さで示す。
 */
function CandidatesSection({ rows }: CandidatesSectionProps) {
  return (
    <section className="candidates-section">
      {rows.map((row) => (
        <MoveSequence
          key={row.rank}
          moves={[...row.moves]}
          variant={row.isBest ? "primary" : "candidate"}
          evaluation={row.evaluation}
          delta={row.isBest ? undefined : row.delta}
        />
      ))}
      {rows.length === 0 && <p className="candidates-section__empty">候補手なし</p>}
    </section>
  );
}

export default CandidatesSection;
