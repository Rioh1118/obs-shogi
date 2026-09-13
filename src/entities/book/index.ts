export { BookProvider } from "./model/provider";
export { useBook } from "./model/useBook";
export type { BookContextType, BookFailure, BookViewState } from "./model/context";

// **載せるのは、スライスの外に呼び手が居るものだけ。** 呼び手0の口を載せると、
// 次に触る人が「その口が正しい入口だ」と読む（`entities/analysis` の barrel と同じ約束）
export type { BookMove } from "./model/types";

// 表の組み立て。**定跡ビューだけが呼ぶが、スライスの外なのでここへ載せる**
export { countBarRatio, DEFAULT_BOOK_SORT, maxCount, nextBookSort, sortBookRows } from "./lib/rows";
export type { BookRow, BookSort, BookSortKey } from "./lib/rows";

export { bookLineLabel } from "./lib/lineLabel";
export { bookNoticeTier } from "./lib/noticeTier";

// 最近開いた定跡。**設定へ書くのは呼び手**（`AppConfig` を読むとスライス横断になる）
export { bookFileName, bookParentPath, readRecentBooks, rememberBook } from "./lib/recents";
