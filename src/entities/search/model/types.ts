import type {
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
} from "../api/contract";
import type {
  IndexProgressPayload,
  IndexStatePayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchChunkPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "../api/events";
import type { FilePathEntry, PositionHit, RequestId } from "../api/ids";

export type IndexUiState = {
  state: IndexStatePayload["state"] | "Empty";
  dirtyCount: number;
  indexedFiles: number;
  totalFiles: number;
  doneFiles: number;
  currentPath: string | null;
};

export type SearchSession = {
  requestId: RequestId;
  stale: boolean;
  isDone: boolean;
  error: string | null;
  hits: PositionHit[];
  startedAt: number;
  endedAt: number | null;
};

export type FilePathById = Record<number, string>;

export type SearchState = {
  // index
  index: IndexUiState;
  warns: IndexWarnPayload[];

  filePathById: FilePathById;

  // open project
  isOpeningProject: boolean;
  lastOpenedRootDir: string | null;
  lastOpenResult: OpenProjectOutput | null;
  openError: string | null;

  // search
  isSearching: boolean;
  currentRequestId: RequestId | null;
  sessions: Record<number, SearchSession>; // requestId -> session
};

export type Action =
  // index events
  | { type: "index_state"; payload: IndexStatePayload }
  | { type: "index_progress"; payload: IndexProgressPayload }
  | { type: "index_warn"; payload: IndexWarnPayload }
  | { type: "clear_warns" }

  // open project lifecycle
  | { type: "open_start"; payload: { rootDir: string } }
  | { type: "open_ok"; payload: { rootDir: string; out: OpenProjectOutput } }
  | { type: "open_error"; payload: { message: string } }

  // search events
  | { type: "search_begin"; payload: SearchBeginPayload }
  | { type: "search_chunk"; payload: SearchChunkPayload }
  | { type: "search_end"; payload: SearchEndPayload }
  | { type: "search_error"; payload: SearchErrorPayload }
  | { type: "clear_search"; payload?: { requestId?: RequestId } };

export type PositionSearchContextType = {
  state: SearchState;

  // actions
  openProject: (rootDir?: string) => Promise<OpenProjectOutput>;
  searchPosition: (input: SearchPositionInput) => Promise<SearchPositionOutput>;
  searchCurrentPositionBestEffort: (
    chunkSize?: number,
  ) => Promise<SearchPositionOutput>;

  // helpers
  getCurrentSession: () => SearchSession | null;
  getHits: () => PositionHit[];
  getAbsPathByFileId: (fileId: number) => string | null;
  resolveHitAbsPath: (hit: PositionHit) => string | null;

  clearWarns: () => void;
  clearSearch: (requestId?: RequestId) => void;
};

export type MergeFilesInput = FilePathEntry[];
