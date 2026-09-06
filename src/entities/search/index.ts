export type {
  Consistency,
  OpenProjectInput,
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
} from "./api/contract";

export type {
  FileId,
  Gen,
  NodeId,
  RequestId,
  ForkPointer,
  Occurrence,
  FilePathEntry,
  CursorLite,
  PositionHit,
} from "./api/ids";

export type {
  IndexState,
  IndexStatePayload,
  IndexProgressPayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchChunkPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "./api/events";

export {
  EVT_INDEX_STATE,
  EVT_INDEX_PROGRESS,
  EVT_INDEX_WARN,
  EVT_SEARCH_BEGIN,
  EVT_SEARCH_CHUNK,
  EVT_SEARCH_END,
  EVT_SEARCH_ERROR,
} from "./api/events";

/**
 * **`api/tauri` の口はここから出さない。**
 *
 * 検索の生死（rid の発行・取り下げ・結果の破棄）は `PositionSearchProvider` が
 * 1人で持つ。生の `searchPosition` を barrel から出すと、その provider を通らずに
 * 検索を起こす形が1 import で作れる——そうして立った rid は `clearSearch` の
 * 対象にならないので、モーダルを閉じても結果が解放されない。
 * スライスの中からは相対で読むこと。
 */

/**
 * 索引のカーソルを `CursorPath` に直す唯一の関門。**素の `CursorLite` を
 * 自分で組み直さないこと**（並びと `te <= tesuu` の前提をここで揃えている）。
 */
export { cursorFromLite } from "./lib/cursorAdapter";
export { isIndexBusy } from "./lib/indexState";

export { PositionSearchProvider } from "./model/provider";
export { usePositionSearch } from "./model/usePositionSearch";

export type {
  SearchState,
  SearchSession,
  IndexUiState,
  FilePathById,
  PositionSearchContextType,
} from "./model/types";
