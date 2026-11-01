// `src-tauri/src/search/types.rs` の写し。欄の一致は `src/__tests__/searchWire.test.ts` が見る。

import type { FilePathEntry, PositionHit, RequestId } from "./ids";

export type IndexState = "Empty" | "Restoring" | "Building" | "Ready" | "Updating";

export type IndexStatePayload = {
  state: IndexState;
  dirtyCount: number;
  /**
   * 索引に入った棋譜の数。意味は `state` で変わる。
   *
   * - `Ready`: 索引を組めた棋譜の数。`totalFiles` との差は検索に出ない棋譜
   * - `Updating`: 据わっている索引の数。差はまだ当てていない差分
   * - `Building`: いままでに組めた数。差は未処理と失敗の合計
   * - `Restoring`: 0。索引を捨てた直後
   *
   * `indexHealth` が `Ready` のときだけ差を読むのはこのため。条件を広げると、
   * 進行中の数が「一部を索引に入れられていません」と出る。
   */
  indexedFiles: number;
  totalFiles: number;
  /**
   * 最後の走査を最後まで通せなかった。
   *
   * 差分更新なら索引は最後に読めたときのまま健全なので `state` は `Ready` で届くが、
   * それ以降の変更は反映されていない。全件構築なら索引は無く、`state` は `Empty` で届く。
   *
   * このとき `dirtyCount` の 0 は「分からない」の意味で、「未同期 0」と描くと
   * 利用者は索引が最新だと読む。
   */
  scanFailed: boolean;
  /**
   * 一部の場所を読めなかった。走査そのものは完走している。
   *
   * `scanFailed` は索引が新しくなっていないことを言う。こちらは読めなかった場所の棋譜が
   * 索引に無いか、古いままであることを言う。畳むと、検索が0件を返した理由を取り違える。
   */
  partiallyUnreadable: boolean;
};

export type IndexProgressPayload = {
  currentPath: string;
  doneFiles: number;
  totalFiles: number;
};

/**
 * 警告の対象。
 *
 * 場所とファイルを分けるのは、画面の枠が限られるため。混ぜると再走査のファイル単位の
 * 警告が、利用者が次にすることを含む場所の警告を押し出す。
 */
export type IndexWarnKind = "place" | "file";

export type IndexWarnPayload = {
  kind: IndexWarnKind;
  path: string;
  message: string;
};

export type SearchBeginPayload = {
  requestId: RequestId;
  stale: boolean;
};

export type SearchChunkPayload = {
  requestId: RequestId;
  chunk: PositionHit[];
  files: FilePathEntry[];
};

export type SearchEndPayload = {
  requestId: RequestId;
};

export type SearchErrorPayload = {
  requestId: RequestId;
  message: string;
};

export const EVT_INDEX_STATE = "position-index-state" as const;
export const EVT_INDEX_PROGRESS = "position-index-progress" as const;
export const EVT_INDEX_WARN = "position-index-warn" as const;

export const EVT_SEARCH_BEGIN = "position-search-begin" as const;
export const EVT_SEARCH_CHUNK = "position-search-chunk" as const;
export const EVT_SEARCH_END = "position-search-end" as const;
export const EVT_SEARCH_ERROR = "position-search-error" as const;
