import type { BookLine, BookMove } from "../model/types";

/**
 * その手の先を辿った結果。**「まだ届いていない」と「辿れなかった」を同じ値にしない。**
 *
 * `null` の1つに潰すと、辿るのに失敗した回も「この先」列が
 * 「辿っています」と言い続ける —— 辿るのはもう終わっているのに、
 * 利用者には重い処理が走っているようにしか見えず、待てば埋まると読む。
 */
export type BookRowLine =
  | { state: "pending" }
  | { state: "walked"; line: BookLine }
  | { state: "failed" };

/** 表の1行。**線は遅れて届く**ので、候補手と別に持つ */
export type BookRow = {
  move: BookMove;
  line: BookRowLine;
};

/**
 * 並べ替えの鍵。`"book"` は**定跡ファイルに書かれている順**で、既定。
 *
 * 既定を評価値にしない —— 辿る先を決めているのも書かれている順（Rust の `walk_line`）
 * なので、既定で並べ替えると「この先」列の根拠と画面の並びが食い違う。
 */
export type BookSortKey = "book" | "value" | "count" | "depth";

export type BookSort = {
  key: BookSortKey;
  /** `true` で大きいものが上。`"book"` では向きを持たない */
  desc: boolean;
};

export const DEFAULT_BOOK_SORT: BookSort = { key: "book", desc: true };

/**
 * 並べ替えた行を返す。**元の配列は変えない。**
 *
 * **欄が欠けている行は、向きに関わらず必ず下。** 昇順で上へ来させると、
 * 「出現回数の少ない順」を押しただけで**回数の分かっていない手が一面に出る**
 * （欠けているのは 0 回ではない）。
 *
 * 同点の並びは定跡が書いた順のまま（`Array.prototype.sort` は安定）。
 */
export function sortBookRows(rows: readonly BookRow[], sort: BookSort): BookRow[] {
  if (sort.key === "book") return [...rows];

  const valueOf = (row: BookRow): number | null => {
    const { value, count, depth } = row.move;
    if (sort.key === "value") return value;
    if (sort.key === "count") return count === null ? null : Number(count);
    return depth;
  };

  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);

    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    return sort.desc ? right - left : left - right;
  });
}

/**
 * 同じ列をもう一度押したときの次の並び。**別の列なら大きい順から始める。**
 *
 * 評価値も出現回数も深さも「大きいほうが先に見たい」ので、最初の1押しで
 * 昇順にしない。3つ目の状態（既定へ戻る）は持たない —— 戻したい人は
 * 既定の列を押せば戻る。
 */
export function nextBookSort(current: BookSort, key: BookSortKey): BookSort {
  if (key === "book") return DEFAULT_BOOK_SORT;
  if (current.key !== key) return { key, desc: true };
  return { key, desc: !current.desc };
}

/**
 * 出現回数のバーの長さ（0〜1）。**一覧の最大値を 1 とする相対値。**
 *
 * 絶対値で描けない —— 回数は定跡によって桁が違う（数回のものと数百万回のものが
 * 同じ画面に並ぶ）。比べたいのは「この局面の中でどれが多く選ばれたか」。
 *
 * 最大が 0 のときは全部 0。**割り算をしない**（0 除算で `NaN` が幅に入ると、
 * バーが消えるのではなく**要素ごと潰れて行の高さが変わる**）。
 */
export function countBarRatio(count: number | null, max: number): number {
  if (count === null || max <= 0) return 0;
  return Math.min(1, count / max);
}

/** 一覧の中でいちばん大きい出現回数。欄が欠けている行は数えない */
export function maxCount(rows: readonly BookRow[]): number {
  return rows.reduce(
    (max, row) => (row.move.count === null ? max : Math.max(max, row.move.count)),
    0,
  );
}

/**
 * 辿った結果を候補手に配る。**並びではなく手の綴りで突き合わせる。**
 *
 * 添字で配ると、並べ替えた後の一覧に当てたときに**黙って別の手の長さが出る**。
 */
export function attachLines(moves: readonly BookMove[], lines: readonly BookLine[]): BookRow[] {
  const byMove = new Map(lines.map((line) => [line.usiMove, line]));

  return moves.map((move) => {
    const line = byMove.get(move.usiMove);
    // 辿った結果に居ない手は**まだ届いていない**扱い。辿れなかったのとは別
    return {
      move,
      line: line ? { state: "walked" as const, line } : { state: "pending" as const },
    };
  });
}

/** 候補手だけが出た行。**辿るのは引くより桁違いに重いので、先にこれを出す** */
export function pendingRows(moves: readonly BookMove[]): BookRow[] {
  return moves.map((move) => ({ move, line: { state: "pending" } }));
}

/** 辿るのに失敗した行。**列が「辿っています」のまま固まらないようにする** */
export function failedRows(moves: readonly BookMove[]): BookRow[] {
  return moves.map((move) => ({ move, line: { state: "failed" } }));
}
