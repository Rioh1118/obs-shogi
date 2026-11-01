export { BookProvider } from "./model/provider";
export { useBook } from "./model/useBook";
export type { BookContextType, BookFailure, BookViewState } from "./model/context";

// 載せるのはスライスの外に呼び手が居るものだけ。呼び手0の名前を載せると、
// 次に触る人が正しい入口だと読む
export type { BookMove } from "./model/types";

// 表の組み立て。呼び手は定跡ビューだけだが、スライスの外なので載せる
export { countBarRatio, DEFAULT_BOOK_SORT, maxCount, nextBookSort, sortBookRows } from "./lib/rows";
export type { BookRow, BookSort, BookSortKey } from "./lib/rows";

export { bookLineLabel } from "./lib/lineLabel";
export { bookNoticeTier } from "./lib/noticeTier";

// 最近開いた定跡。`AppConfig` を読むとスライス横断になるので、設定へ書くのは呼び手
export { bookFileName, bookParentPath, readRecentBooks, rememberBook } from "./lib/recents";
