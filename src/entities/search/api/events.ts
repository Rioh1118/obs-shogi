import type { FilePathEntry, PositionHit, RequestId } from "./ids";

// Rust: pub enum IndexState
export type IndexState = "Empty" | "Restoring" | "Building" | "Ready" | "Updating";

// camelCase via serde(rename_all = "camelCase")
export interface IndexStatePayload {
  state: IndexState;
  dirtyCount: number;
  /**
   * **段によって意味が違う。**
   *
   * - `Ready`: 索引を組めた棋譜の数。`totalFiles` との差が**検索に出ない棋譜**
   * - `Updating`: 据わっている索引の数。差は**まだ当てていない差分**
   * - `Building`: その回でいままでに組めた数。差は**未処理と失敗の合計**
   * - `Restoring`: 0（索引を捨てた直後）
   *
   * `indexHealth` が `Ready` に限って差を読むのはこのため。段を足すときに
   * 条件を広げると、進行中の走行中カウントが「一部を索引に入れられていません」に化ける。
   */
  indexedFiles: number;
  totalFiles: number;
  /**
   * 最後の走査を最後まで通せなかった。
   *
   * **索引は最後に読めたときのまま健全**なので段は `Ready` で来るが、
   * それ以降の追加・変更・削除は1件も反映されていない。
   * このとき `dirtyCount` の 0 は「無い」ではなく**「分からない」**
   * ——そのまま「未同期 0」と描くと、利用者は索引が最新だと確信する。
   */
  scanFailed: boolean;
  /**
   * 一部の場所を読めなかった。走査そのものは完走している。
   *
   * `scanFailed` とは失われるものが違う——あちらは「索引が新しくなっていない」、
   * こちらは「**索引に入っていない棋譜がある**」。畳むと、検索が0件を
   * 返した理由を利用者が取り違える。
   */
  partiallyUnreadable: boolean;
}

export interface IndexProgressPayload {
  currentPath: string;
  doneFiles: number;
  totalFiles: number;
}

/**
 * 警告が**何について**のものか。Rust: `pub enum IndexWarnKind`
 *
 * **場所とファイルを混ぜない。** 画面は限られた枠しか出せないので、混ぜると
 * 1回の再走査で出るファイル単位の警告が場所の警告を押し出す——押し出される
 * のは「ワークスペースを読めません」のような、**利用者が次にすることを
 * 含んだ唯一の文言**のほう。
 */
export type IndexWarnKind = "place" | "file";

export interface IndexWarnPayload {
  kind: IndexWarnKind;
  path: string;
  message: string;
}

export interface SearchBeginPayload {
  requestId: RequestId;
  stale: boolean;
}

export interface SearchChunkPayload {
  requestId: RequestId;
  chunk: PositionHit[];
  files: FilePathEntry[];
}

export interface SearchEndPayload {
  requestId: RequestId;
}

export interface SearchErrorPayload {
  requestId: RequestId;
  message: string;
}

// ===== イベント名（Rust const と一致させる） =====
export const EVT_INDEX_STATE = "position-index-state" as const;
export const EVT_INDEX_PROGRESS = "position-index-progress" as const;
export const EVT_INDEX_WARN = "position-index-warn" as const;

export const EVT_SEARCH_BEGIN = "position-search-begin" as const;
export const EVT_SEARCH_CHUNK = "position-search-chunk" as const;
export const EVT_SEARCH_END = "position-search-end" as const;
export const EVT_SEARCH_ERROR = "position-search-error" as const;
