import { formatEvaluation } from "@/widgets/analysis-pane/lib/sfenConverter";
import { formatDelta, type CandidateRow } from "@/widgets/analysis-pane/lib/candidateRows";
import "./CandidateDetail.scss";

type Props = {
  rows: readonly CandidateRow[];
  /** 選んでいる候補の `rank`。**モードを跨いで持ち回る** */
  selectedRank: number | null;
  onSelect: (rank: number) => void;
};

/**
 * 一覧と詳細。**読み筋を折り返して全文出せる唯一のモード。**
 *
 * 行と表は1行に収めるので、長い読み筋は右端で切れる。切れた先へ届く手段が
 * `title` 属性しか無かった（選択もコピーもできない）のを、ここで解く。
 */
function CandidateDetail({ rows, selectedRank, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="candidate-detail__empty">候補手なし</p>;
  }

  // 選んでいない回・選んだ候補が消えた回は最善手を出す。**空欄にしない** ——
  // 詳細の側が空だと、モードを切り替えた人には壊れて見える
  const selected = rows.find((r) => r.rank === selectedRank) ?? rows[0];

  return (
    <div className="candidate-detail">
      <ul className="candidate-detail__list">
        {rows.map((row) => (
          <li key={row.rank}>
            <button
              type="button"
              className={`candidate-detail__item ${row.rank === selected.rank ? "candidate-detail__item--selected" : ""}`}
              aria-pressed={row.rank === selected.rank}
              onClick={() => onSelect(row.rank)}
            >
              <span className="candidate-detail__move">{row.moves[0]?.move ?? "—"}</span>
              <span className="candidate-detail__score">{formatEvaluation(row.evaluation)}</span>
              <span className="candidate-detail__delta">{formatDelta(row.delta)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="candidate-detail__pv">
        {selected.moves.length === 0 ? (
          <p className="candidate-detail__empty">読み筋がありません</p>
        ) : (
          <p className="candidate-detail__pvText">{selected.moves.map((m) => m.move).join(" ")}</p>
        )}
      </div>
    </div>
  );
}

export default CandidateDetail;
