import type { BookLine, BookMove } from "../model/types";

/**
 * その手の先を辿った結果。
 *
 * まだ届いていないことと、辿れなかったことを分ける。`null` に潰すと、失敗した後も「この先」列が
 * 「辿っています」と言い続け、利用者は待てば埋まると読む。
 */
export type BookRowLine =
  | { state: "pending" }
  | { state: "walked"; line: BookLine }
  | { state: "failed" };

/** 表の1行。線は遅れて届くので、候補手と別に持つ */
export type BookRow = {
  move: BookMove;
  line: BookRowLine;
};

/**
 * 並べ替えの鍵。`"book"` は定跡ファイルに書かれている順で、既定。
 *
 * 既定を評価値にしない。Rust の `walk_line` も書かれている順の先頭を辿るので、
 * 既定で並べ替えると「この先」列の根拠と画面の並びが食い違う。
 */
export type BookSortKey = "book" | "value" | "count" | "depth";

export type BookSort = {
  key: BookSortKey;
  /** `true` で大きいものが上。`"book"` では向きを持たない */
  desc: boolean;
};

export const DEFAULT_BOOK_SORT: BookSort = { key: "book", desc: true };

/**
 * 並べ替えた行を新しい配列で返す。同点は定跡が書いた順のまま。
 *
 * 欄が欠けている行は向きによらず下へ置く。昇順で上へ来させると、「少ない順」を押しただけで
 * 回数の分かっていない手が一面に出る。欠けているのは 0 回ではない。
 */
export function sortBookRows(rows: readonly BookRow[], sort: BookSort): BookRow[] {
  if (sort.key === "book") return [...rows];

  const valueOf = (row: BookRow): number | null => {
    const { value, count, depth } = row.move;
    if (sort.key === "value") return value;
    if (sort.key === "count") return count;
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
 * 列を押した後の並びを返す。別の列なら大きい順から始め、同じ列なら向きを返す。
 *
 * 評価値も出現回数も深さも、大きいほうを先に見たい。3つ目の状態は持たない。
 * 既定へ戻すには既定の列を押す。
 */
export function nextBookSort(current: BookSort, key: BookSortKey): BookSort {
  if (key === "book") return DEFAULT_BOOK_SORT;
  if (current.key !== key) return { key, desc: true };
  return { key, desc: !current.desc };
}

/**
 * 出現回数のバーの長さ（0〜1）を、一覧の最大値を 1 とする相対値で返す。
 *
 * 回数は定跡によって桁が違うので絶対値では描けない。比べたいのはこの局面の中の多さ。
 *
 * 最大が 0 なら 0 を返す。0 除算の `NaN` を `--book-bar-fill` へ渡さない。
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
 * 辿った結果を候補手に配る。添字でなく手の綴りで突き合わせる。
 *
 * 添字で配ると、並べ替えた後の一覧に当てたときに別の手の長さが黙って出る。
 */
export function attachLines(moves: readonly BookMove[], lines: readonly BookLine[]): BookRow[] {
  const byMove = new Map(lines.map((line) => [line.usiMove, line]));

  return moves.map((move) => {
    const line = byMove.get(move.usiMove);
    // 辿った結果に居ない手は、まだ届いていない扱い。辿れなかったのとは別
    return {
      move,
      line: line ? { state: "walked" as const, line } : { state: "pending" as const },
    };
  });
}

/** 候補手だけが出た行を返す。辿るのは引くより重いので、先にこれを出す */
export function pendingRows(moves: readonly BookMove[]): BookRow[] {
  return moves.map((move) => ({ move, line: { state: "pending" } }));
}

/** 辿るのに失敗した行を返す。列が「辿っています」のまま固まらないようにする */
export function failedRows(moves: readonly BookMove[]): BookRow[] {
  return moves.map((move) => ({ move, line: { state: "failed" } }));
}
