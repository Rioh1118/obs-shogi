import type { IndexState } from "../api/events";

/**
 * 索引がいま動いているか。**動いているあいだの結果は最新とは限らない。**
 *
 * **表で書く。** 段を or で並べると、`IndexState` に段が1つ増えても tsc は落ちず、
 * 新しい段は黙って「動いていない」側に落ちる——そのとき局面検索は結果に「更新中」を
 * 付けず、**索引を組み直している最中の0件が、確定した0件として出る**
 * （`search.md` が核心の欠陥と呼ぶもの → #350）。表なら**段が増えた瞬間に
 * ここで分類を迫られる**。
 */
const BUSY: Record<IndexState, boolean> = {
  Empty: false,
  Restoring: true,
  Building: true,
  Ready: false,
  Updating: true,
};

export const isIndexBusy = (s: IndexState): boolean => BUSY[s];
