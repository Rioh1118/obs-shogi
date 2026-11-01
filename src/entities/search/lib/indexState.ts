import type { IndexState } from "../api/events";

/**
 * 索引がいま動いているかの表。動いている間の結果は最新とは限らない。
 *
 * 段を or で並べると、`IndexState` に段が増えても tsc が落ちず、新しい段は動いていない側へ
 * 落ちる。そのとき局面検索は更新中と出さず、組み直している最中の0件が確定の0件として出る。
 */
const BUSY: Record<IndexState, boolean> = {
  Empty: false,
  Restoring: true,
  Building: true,
  Ready: false,
  Updating: true,
};

export const isIndexBusy = (s: IndexState): boolean => BUSY[s];
