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

export {
  openProject,
  searchPosition,
  searchPositionBestEffort,
  cancelSearch,
  listenSearchEvents,
} from "./api/tauri";

/**
 * 索引のカーソルを `CursorPath` に直す唯一の関門。**素の `CursorLite` を
 * 自分で組み直さないこと**（並びと `te <= tesuu` の前提をここで揃えている）。
 */
export { cursorFromLite } from "./lib/cursorAdapter";

/**
 * 索引の具合を1つに決める唯一の関門。**画面ごとに旗を並べ直さないこと**
 * ——見る順が割れると、同じ状態に別の理由が付く。文言は画面が持ってよいが、
 * **どの具合かの判断はここを通す**。
 */
export { indexHealth } from "./lib/indexHealth";
export type { IndexHealth } from "./lib/indexHealth";

export { PositionSearchProvider } from "./model/provider";
export { usePositionSearch } from "./model/usePositionSearch";

export type {
  SearchState,
  SearchSession,
  IndexUiState,
  FilePathById,
  PositionSearchContextType,
} from "./model/types";
