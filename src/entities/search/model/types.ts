import type { SearchPositionInput } from "../api/contract";
import type {
  IndexProgressPayload,
  IndexState,
  IndexStatePayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "../api/events";
import type { FileId, FilePathEntry, PositionHit, RequestId } from "../api/ids";

export type IndexUiState = {
  state: IndexState;
  dirtyCount: number;
  /** 走査を最後まで通せなかった。意味は `IndexStatePayload` の doc */
  scanFailed: boolean;
  /** 一部の場所を読めなかった。意味は `IndexStatePayload` の doc */
  partiallyUnreadable: boolean;
  indexedFiles: number;
  totalFiles: number;
  doneFiles: number;
  currentPath: string | null;
};

/**
 * 検索1回の結果と進み具合。
 *
 * `chunks` は届いた単位のまま持つ。reducer で `[...hits, ...chunk]` と繋ぐと全体で O(n²) になる。
 * 平らにするのは `flattenHits`。
 */
export type SearchSession = {
  requestId: RequestId;
  stale: boolean;
  isDone: boolean;
  error: string | null;
  chunks: PositionHit[][];
};

/** 検索を起こした結末。受け付けられなかった場合を成功と同じ形にしない */
export type SearchLaunch = { status: "started"; requestId: RequestId } | { status: "superseded" };

export type FilePathById = Record<FileId, string>;

export type SearchState = {
  index: IndexUiState;
  warns: IndexWarnPayload[];

  filePathById: FilePathById;

  openError: string | null;

  sessions: Record<RequestId, SearchSession>;
};

/** 1回ぶんの取り込み。`chunks` は到着順、`files` はそのぶんを平らに繋いだもの */
type SearchChunksInput = {
  requestId: RequestId;
  chunks: PositionHit[][];
  files: FilePathEntry[];
};

export type Action =
  | { type: "index_state"; payload: IndexStatePayload }
  | { type: "index_progress"; payload: IndexProgressPayload }
  | { type: "index_warn"; payload: IndexWarnPayload }
  | { type: "clear_warns" }
  | { type: "open_start" }
  | { type: "open_error"; payload: { message: string } }
  | { type: "search_begin"; payload: SearchBeginPayload }
  /**
   * 到着したチャンクをまとめて積む。溜めるのは `model/chunkBuffer.ts`。
   *
   * `filePathById` と `sessions` はアクションごとに作り直されるので、1チャンク1アクションにしない。
   */
  | { type: "search_chunks"; payload: SearchChunksInput }
  | { type: "search_requested"; payload: { requestId: RequestId } }
  | { type: "search_end"; payload: SearchEndPayload }
  | { type: "search_error"; payload: SearchErrorPayload }
  | { type: "clear_search"; payload: { requestId: RequestId } };

export type PositionSearchContextType = {
  state: SearchState;

  /**
   * 検索を起こす。結末は `SearchLaunch` の2つ。
   *
   * `"started"` なら結果はイベントで届き、`requestId` で引ける。
   * `"superseded"` は番号が返るまでの間に索引が開き直された場合で、state に何も残らず、
   * Rust へ取り下げを頼んである。
   *
   * 成功と同じ形で返すと、呼び手がセッションの無い rid を握り、「一致する棋譜がありません」が
   * 完了として出る。
   */
  searchPosition: (input: SearchPositionInput) => Promise<SearchLaunch>;

  cancelSearch: (requestId: RequestId) => Promise<void>;

  getSessionByRequestId: (requestId: RequestId | null) => SearchSession | null;

  /**
   * その検索のヒットを届いた順に平らにして返す。
   *
   * 返り値は共有の配列なので `sort`、`reverse`、`push` を呼ばない。同じ到着分には同じ配列を返し、
   * 増えたら別の配列を返すので、呼び手は同一性で増えたかを判断できる。
   */
  getHitsByRequestId: (requestId: RequestId | null) => PositionHit[];
  isSearchingRequest: (requestId: RequestId | null) => boolean;
  resolveHitAbsPath: (hit: PositionHit) => string | null;

  clearWarns: () => void;
  clearSearch: (requestId: RequestId) => void;
};
