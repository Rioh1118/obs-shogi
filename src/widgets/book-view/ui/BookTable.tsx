import {
  bookLineLabel,
  countBarRatio,
  maxCount,
  nextBookSort,
  sortBookRows,
  type BookRow,
  type BookSort,
  type BookSortKey,
} from "@/entities/book";
import type { CSSProperties } from "react";
import { bookMoveTexts } from "../lib/moveTexts";
import "./BookTable.scss";

type Props = {
  rows: readonly BookRow[];
  /** 行を組む土台の局面。**指し手を日本語にするのに要る** */
  sfen: string | null;
  /** 現局面までに指された手数。「この先」列の絶対手数の土台 */
  baseTesuu: number;
  sort: BookSort;
  onSort: (sort: BookSort) => void;
  /** 1行も無いときの文言。**引いている最中と、定跡に無いのとで違う** */
  empty: string;
};

/** 押せる見出し。**並べ替えられる列だけがこれになる** */
const SORTABLE: { key: BookSortKey; label: string }[] = [
  { key: "value", label: "評価" },
  { key: "depth", label: "深さ" },
  { key: "count", label: "出現回数" },
];

/**
 * 現局面の候補手を列で揃えて出す。
 *
 * **盤を持たない。**「その手を指した先も定跡にあるか」は盤ではなく「この先」列で出す
 * （ADR-0010／`docs/spec/features/book.md`）。
 *
 * **行は押せない。** 押した先に出すものが無い（詳細ペインを持たない。
 * 判断は ADR-0010 決定2）。ホバーで下線が付くのは読む位置の手掛かりで、
 * 押せることの合図ではない（`BookTable.scss` の `&__row:hover`）。
 *
 * 並べ替えの既定は**定跡ファイルに書かれている順**。辿る先を決めているのも
 * その順なので（Rust の `walk_line`）、既定を評価値にすると「この先」列の根拠と
 * 画面の並びが食い違う。
 */
function BookTable({ rows, sfen, baseTesuu, sort, onSort, empty }: Props) {
  const sorted = sortBookRows(rows, sort);
  const barBase = maxCount(rows);

  const header = ({ key, label }: { key: BookSortKey; label: string }) => {
    const active = sort.key === key;
    // 出現回数だけ見出しが4文字あり、中身も桁区切り付きで長い（`BookTable.scss`）
    const column = key === "count" ? "book-table__th--count" : "book-table__th--num";
    return (
      <th key={key} scope="col" className={column} aria-sort={ariaSort(sort, key)}>
        <button
          type="button"
          className={`book-table__sort ${active ? "book-table__sort--active" : ""}`}
          onClick={() => onSort(nextBookSort(sort, key))}
        >
          {label}
          {/* **向きは記号で出す。** 色だけだと、押せることと押した結果が同じ手掛かりになる */}
          <span aria-hidden="true" className="book-table__caret">
            {active ? (sort.desc ? "▾" : "▴") : ""}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="book-table">
      <table className="book-table__grid">
        <thead>
          <tr>
            <th scope="col" className="book-table__th--move">
              <button
                type="button"
                className={`book-table__sort ${sort.key === "book" ? "book-table__sort--active" : ""}`}
                onClick={() => onSort(nextBookSort(sort, "book"))}
                title="定跡に書かれている順に戻す"
              >
                指し手
              </button>
            </th>
            {SORTABLE.map(header)}
            <th scope="col" className="book-table__th--ponder">
              応手
            </th>
            <th scope="col" className="book-table__th--ahead">
              この先
            </th>
          </tr>
        </thead>
        <tbody>
          {/*
            **空でも見出しは残す。** 器ごと消すと、候補手が届いた瞬間に見出しが生えて
            下の行が押し下がる（`CandidateTable` と同じ理由）
          */}
          {sorted.length === 0 && (
            <tr>
              <td className="book-table__empty" colSpan={6}>
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((row) => {
            const label = bookLineLabel(row.line, baseTesuu);
            const texts = bookMoveTexts(sfen, row.move);

            return (
              <tr key={row.move.usiMove} className="book-table__row">
                {/*
                  **切れた先へ届く手段を置く。** 日本語1手は全角4〜6字あり、
                  幅の足りない窓では成・不成や右・左・引が落ちる。落ちたぶんは
                  別の手として読めてしまうので、`title` で全文を出す
                */}
                <td className="book-table__move" title={texts.move}>
                  {texts.move}
                </td>
                <td className="book-table__num">{formatValue(row.move.value)}</td>
                <td className="book-table__num book-table__dim">{row.move.depth ?? "—"}</td>
                <td className="book-table__count" title={formatCount(row.move.count)}>
                  <span className="book-table__count-num">{formatCount(row.move.count)}</span>
                  {/*
                    **一覧の最大値を 1 とする相対の長さ。** 回数の桁は定跡によって違うので、
                    絶対値では比べられない。比べたいのは「この局面の中でどれが多いか」
                  */}
                  <span
                    className="book-table__bar"
                    aria-hidden="true"
                    style={
                      {
                        "--book-bar-fill": `${countBarRatio(row.move.count, barBase) * 100}%`,
                      } as CSSProperties
                    }
                  />
                </td>
                <td className="book-table__dim" title={texts.ponder}>
                  {texts.ponder}
                </td>
                <td
                  className={`book-table__ahead ${label.continues ? "book-table__ahead--continues" : "book-table__dim"}`}
                  title={label.hint ?? label.text}
                >
                  {label.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 手番側から見た評価値。**符号を付ける** —— 付けないと 0 を跨いだ側が読めない */
function formatValue(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value}` : `${value}`;
}

/** 出現回数。**欄が欠けているのと 0 回は別物**なので、同じ綴りにしない */
function formatCount(count: number | null): string {
  return count === null ? "—" : count.toLocaleString();
}

function ariaSort(sort: BookSort, key: BookSortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.desc ? "descending" : "ascending";
}

export default BookTable;
