import type { IndexState } from "../api/events";

/**
 * 索引がいま動いているか。**動いているあいだの結果は最新とは限らない。**
 *
 * 段を or で並べる形を各画面に手書きさせない。`IndexState` に段が1つ増えたとき、
 * union の手書きは tsc が落とすが**3項の or は落ちない**——新しい段が「動いている」側
 * だった場合、局面検索は結果に「更新中」を付けず、**0件が「完了・最新」として出る**。
 * それは `search.md` が核心の欠陥と呼んでいるものそのもの（→ #350）。
 */
export const isIndexBusy = (s: IndexState | "Empty"): boolean =>
  s === "Restoring" || s === "Building" || s === "Updating";
