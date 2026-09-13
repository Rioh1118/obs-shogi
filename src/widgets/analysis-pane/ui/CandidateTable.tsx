import { formatEvaluation } from "@/widgets/analysis-pane/lib/sfenConverter";
import type { CandidateRow } from "@/widgets/analysis-pane/lib/candidateRows";
import "./CandidateTable.scss";

type Props = {
  rows: readonly CandidateRow[];
  /** 選んでいる候補の `rank`。**モードを跨いで持ち回る** */
  selectedRank: number | null;
  onSelect: (rank: number) => void;
};

/**
 * 候補手を列で揃えて出す。**列の意味がここで決まる。**
 *
 * 定跡ビュー（#95）の表も同じ形になる予定なので、2枚目が来たときに
 * 「列の定義を差し替えられる部品」として下げる。**いまは1枚なので widget の中に置く。**
 *
 * 読み筋は1行に収める（`text-overflow`）。**全文は「詳」のモードで読む** ——
 * ここで折り返すと行の高さが揃わず、列で揃えるという表の取り柄が消える。
 */
function CandidateTable({ rows, selectedRank, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="candidate-table__empty">候補手なし</p>;
  }

  return (
    <div className="candidate-table">
      <table className="candidate-table__grid">
        <thead>
          <tr>
            <th scope="col" className="candidate-table__th--move">
              指し手
            </th>
            <th scope="col" className="candidate-table__th--score">
              評価値
            </th>
            <th scope="col">読み筋</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.rank}
              className={[
                "candidate-table__row",
                row.isBest ? "candidate-table__row--best" : "",
                row.rank === selectedRank ? "candidate-table__row--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-selected={row.rank === selectedRank}
              onClick={() => onSelect(row.rank)}
            >
              <td className="candidate-table__move">{row.moves[0]?.move ?? "—"}</td>
              <td className="candidate-table__score">{formatEvaluation(row.evaluation)}</td>
              <td className="candidate-table__pv">{row.moves.map((m) => m.move).join(" ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default CandidateTable;
