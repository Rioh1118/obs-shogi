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
  listenSearchEvents,
  filterByRequestId,
} from "./api/tauri";

export { PositionSearchProvider } from "./model/provider";
export { usePositionSearch } from "./model/usePositionSearch";

export type {
  SearchState,
  SearchSession,
  IndexUiState,
  FilePathById,
  PositionSearchContextType,
} from "./model/types";
