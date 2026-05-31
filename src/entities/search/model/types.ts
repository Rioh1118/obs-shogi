import type {
  Consistency,
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

/**
 * セッション。chunks に到着したチャンクを配列のまま保持し、reducer は
 * `[...hits, ...chunk]` の O(n²) を回避する (C-M1)。フラット化は provider 側で
 * 償却 O(n) のキャッシュにして返す。
 */
export type SearchSession = {
  requestId: RequestId;
  querySfen: string | null;
  consistency: Consistency | null;
  stale: boolean;
  isDone: boolean;
  error: string | null;
  chunks: PositionHit[][];
  startedAt: number;
  endedAt: number | null;
};

export type FilePathById = Record<number, string>;

export type SearchState = {
  index: IndexUiState;
  warns: IndexWarnPayload[];

  filePathById: FilePathById;

  isOpeningProject: boolean;
  lastOpenedRootDir: string | null;
  lastOpenResult: OpenProjectOutput | null;
  openError: string | null;

  isSearching: boolean;
  currentRequestId: RequestId | null;
  sessions: Record<number, SearchSession>;
};

export type Action =
  | { type: "index_state"; payload: IndexStatePayload }
  | { type: "index_progress"; payload: IndexProgressPayload }
  | { type: "index_warn"; payload: IndexWarnPayload }
  | { type: "clear_warns" }
  | { type: "open_start"; payload: { rootDir: string } }
  | { type: "open_ok"; payload: { rootDir: string; out: OpenProjectOutput } }
  | { type: "open_error"; payload: { message: string } }
  | { type: "search_begin"; payload: SearchBeginPayload }
  | { type: "search_chunk"; payload: SearchChunkPayload }
  | {
      type: "search_requested";
      payload: {
        requestId: RequestId;
        sfen: string;
        consistency: Consistency;
      };
    }
  | { type: "search_end"; payload: SearchEndPayload }
  | { type: "search_error"; payload: SearchErrorPayload }
  | { type: "clear_search"; payload: { requestId: RequestId } };

export type PositionSearchContextType = {
  state: SearchState;

  openProject: (rootDir?: string) => Promise<OpenProjectOutput>;

  searchPosition: (input: SearchPositionInput) => Promise<SearchPositionOutput>;

  searchCurrentPositionBestEffort: (opts?: {
    chunkSize?: number;
    consistency?: Consistency;
  }) => Promise<SearchPositionOutput>;

  cancelSearch: (requestId: RequestId) => Promise<void>;

  getSessionByRequestId: (requestId: RequestId | null | undefined) => SearchSession | null;
  getHitsByRequestId: (requestId: RequestId | null | undefined) => PositionHit[];
  isSearchingRequest: (requestId: RequestId | null | undefined) => boolean;
  getAbsPathByFileId: (fileId: number) => string | null;
  resolveHitAbsPath: (hit: PositionHit) => string | null;

  clearWarns: () => void;
  clearSearch: (requestId: RequestId) => void;
};

export type MergeFilesInput = FilePathEntry[];
