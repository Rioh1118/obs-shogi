import type { Consistency, OpenProjectOutput, SearchPositionInput } from "../api/contract";
import type {
  IndexProgressPayload,
  IndexState,
  IndexStatePayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "../api/events";
import type { FilePathEntry, PositionHit, RequestId } from "../api/ids";

export type IndexUiState = {
  state: IndexState;
  dirtyCount: number;
  indexedFiles: number;
  totalFiles: number;
  doneFiles: number;
  currentPath: string | null;
};

/**
 * セッション。chunks に到着したチャンクを配列のまま保持し、reducer は
 * `[...hits, ...chunk]` の O(n²) を回避する。フラット化は provider 側で
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

/** 検索を起こした結末。**受け付けられなかった回を成功と同じ形にしない** */
export type SearchLaunch = { status: "started"; requestId: RequestId } | { status: "superseded" };

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
  /**
   * 到着したチャンクを**まとめて**積む。
   *
   * 1チャンク1アクションにしない。`filePathById` と `sessions` はアクション1回ごとに
   * 作り直されるので、10万件の表を「件数 ÷ 区切り」回コピーすることになる。
   * 溜めるのは `model/provider.tsx`。
   */
  | { type: "search_chunks"; payload: SearchChunksInput }
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

  /**
   * 検索を起こす。**結末は2つあり、型で分かれる。**
   *
   * `"started"` なら結果はイベントで届き、`requestId` で引ける。
   * `"superseded"` は**受け付けられなかった**回——番号が返るまでの間に索引が
   * 開き直され、この検索は state にも溜め場にも残っていない（Rust 側も取り下げ済み）。
   *
   * **成功と同じ形で返さない。** 返すと呼び手は `requestId` を採用し、セッションの
   * 無い rid を握って「待機中 / 一致する棋譜がありません」を出す——0件が完了として
   * 出る形（`docs/state-transitions/search.md`）。分岐を書かない限り tsc が落ちる。
   */
  searchPosition: (input: SearchPositionInput) => Promise<SearchLaunch>;

  cancelSearch: (requestId: RequestId) => Promise<void>;

  getSessionByRequestId: (requestId: RequestId | null | undefined) => SearchSession | null;

  /**
   * その検索のヒットを、届いた順に平らにして返す。
   *
   * **返り値は共有の配列。破壊的に触らないこと**（`sort` / `reverse` / `push`）。
   * 同じ到着ぶんを見ている間は**同じ配列**が返り、増えたときだけ別の配列になる
   * ——呼び手はその同一性で「増えたか」を判断してよい。触ると、次の増分追記が
   * 壊れた並びの上に足される。
   */
  getHitsByRequestId: (requestId: RequestId | null | undefined) => PositionHit[];
  isSearchingRequest: (requestId: RequestId | null | undefined) => boolean;
  getAbsPathByFileId: (fileId: number) => string | null;
  resolveHitAbsPath: (hit: PositionHit) => string | null;

  clearWarns: () => void;
  clearSearch: (requestId: RequestId) => void;
};

export type MergeFilesInput = FilePathEntry[];

/** 1回ぶんの取り込み。`chunks` は到着順、`files` はそのぶんを平らに繋いだもの */
export type SearchChunksInput = {
  requestId: RequestId;
  chunks: PositionHit[][];
  files: MergeFilesInput;
};
