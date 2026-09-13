import { formatEvaluation } from "@/widgets/analysis-pane/lib/sfenConverter";
import { useState } from "react";
import { EMPTY_CANDIDATES } from "@/widgets/analysis-pane/lib/labels";
import type { CandidateRow } from "@/widgets/analysis-pane/lib/candidateRows";
import "./CandidateTable.scss";

type Props = {
  rows: readonly CandidateRow[];
};

/**
 * 候補手を列で揃えて出す。**列の意味がここで決まる。**
 *
 * **2枚目（`widgets/book-view/ui/BookTable.tsx`）は別の部品になっている。**
 * 器（枠・見出しの貼り付け・`td` の省略・空でも見出しを残す行）はほとんどの宣言が
 * 字面まで同じだが、TSX は重ならない —— こちらは行を選べて見出しを押せず、
 * あちらは選べなくて見出しを押せる。
 * どこまで共有するかは **#576 で決める**（分けたままにするなら、この段落と
 * ADR-0010 の「結果」の行を現物へ書き直す）。
 *
 * 読み筋は1行に収める（`text-overflow`）。折り返すと行の高さが揃わず、
 * 列で揃えるという表の取り柄が消える。**切れた先へ届く手段は持たない**
 * （`docs/spec/screens/analysis-pane.md` の「候補手の見せ方」）。
 *
 * 行の選択は**読む位置の印**で、ここから先へ動くものは何も無い。
 * 見せ方を跨いで持ち回らない —— 行モードに選択という概念が無いため。
 */
function CandidateTable({ rows }: Props) {
  // 選んだ候補が消えた回は、どの行も選ばれていない状態になる。**最善手へは落ちない**
  // —— 印なので、指す先が消えたら消えるのが素直
  const [selectedRank, setSelectedRank] = useState<number | null>(null);

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
          {/*
            **空でも見出しは残す。** 器ごと消すと、候補手が届いた瞬間に見出しが生えて
            下の行が押し下がる。行モード（`CandidatesSection`）とも位置が揃わない
          */}
          {rows.length === 0 && (
            <tr>
              <td className="candidate-table__empty" colSpan={3}>
                {EMPTY_CANDIDATES}
              </td>
            </tr>
          )}
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
              onClick={() => setSelectedRank(row.rank)}
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
