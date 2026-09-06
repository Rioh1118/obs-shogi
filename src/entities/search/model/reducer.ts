import type { RequestId } from "../api/ids";
import type { Action, FilePathById, MergeFilesInput, SearchSession, SearchState } from "./types";

/**
 * `state.sessions` を落とすアクション。**この列挙はここが出典**——`sessions` を
 * 消す `case` を足す人が、同じファイルで気づけるようにしておく。
 * 消す側の手順（溜め場を閉じる → 置き場を捨てる → dispatch）は
 * `model/provider.tsx` の `dropSearch` が持つ。
 */
export type DropSearchAction = Extract<Action, { type: "open_start" | "clear_search" }>;

export const initialState: SearchState = {
  index: {
    state: "Empty",
    dirtyCount: 0,
    indexedFiles: 0,
    totalFiles: 0,
    doneFiles: 0,
    currentPath: null,
  },
  warns: [],
  filePathById: {},

  isOpeningProject: false,
  lastOpenedRootDir: null,
  lastOpenResult: null,
  openError: null,

  isSearching: false,
  currentRequestId: null,
  sessions: {},
};

function ensureSession(
  sessions: Record<number, SearchSession>,
  requestId: RequestId,
): Record<number, SearchSession> {
  if (sessions[requestId]) return sessions;
  return {
    ...sessions,
    [requestId]: {
      requestId,
      querySfen: null,
      consistency: null,
      stale: false,
      isDone: false,
      error: null,
      chunks: [],
      startedAt: Date.now(),
      endedAt: null,
    },
  };
}

function mergeFiles(base: FilePathById, files: MergeFilesInput): FilePathById {
  if (!files.length) return base;

  let next: FilePathById | null = null;

  for (const f of files) {
    const prev = base[f.fileId];
    if (prev !== f.absPath) {
      if (!next) next = { ...base };
      next[f.fileId] = f.absPath;
    }
  }

  return next ?? base;
}

export function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    case "index_state": {
      const p = action.payload;
      const isReady = p.state === "Ready";
      return {
        ...state,
        index: {
          ...state.index,
          state: p.state,
          dirtyCount: p.dirtyCount,
          indexedFiles: p.indexedFiles,
          totalFiles: p.totalFiles,
          // Ready 到達時は doneFiles を totalFiles に揃える (C-M2 backstop)
          doneFiles: isReady ? p.totalFiles : Math.min(state.index.doneFiles, p.totalFiles),
        },
      };
    }

    case "index_progress": {
      const p = action.payload;
      return {
        ...state,
        index: {
          ...state.index,
          currentPath: p.currentPath || state.index.currentPath,
          doneFiles: p.doneFiles,
          totalFiles: state.index.totalFiles > 0 ? state.index.totalFiles : p.totalFiles,
        },
      };
    }

    case "index_warn":
      return {
        ...state,
        warns: [...state.warns.slice(-199), action.payload],
      };

    case "clear_warns":
      return { ...state, warns: [] };

    case "open_start":
      return {
        ...state,
        isOpeningProject: true,
        lastOpenedRootDir: action.payload.rootDir,
        openError: null,
        lastOpenResult: null,
        filePathById: {},
        isSearching: false,
        currentRequestId: null,
        sessions: {},
      };

    case "open_ok":
      return {
        ...state,
        isOpeningProject: false,
        lastOpenedRootDir: action.payload.rootDir,
        lastOpenResult: action.payload.out,
        openError: null,
      };

    case "open_error":
      return {
        ...state,
        isOpeningProject: false,
        openError: action.payload.message,
      };

    case "search_begin": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.requestId);
      const s = sessions[p.requestId]!;
      return {
        ...state,
        isSearching: true,
        currentRequestId: p.requestId,
        sessions: {
          ...sessions,
          [p.requestId]: {
            ...s,
            stale: p.stale,
            isDone: false,
            error: null,
            startedAt: s.startedAt || Date.now(),
            endedAt: null,
          },
        },
      };
    }

    case "search_chunks": {
      const p = action.payload;
      if (!p.chunks.length) return state;

      const sessions = ensureSession(state.sessions, p.requestId);
      const s = sessions[p.requestId]!;
      // chunk は配列のまま追加。フラット化は consumer 側で償却 O(n)
      return {
        ...state,
        currentRequestId: state.currentRequestId ?? p.requestId,
        filePathById: mergeFiles(state.filePathById, p.files),
        sessions: {
          ...sessions,
          [p.requestId]: {
            ...s,
            chunks: [...s.chunks, ...p.chunks],
          },
        },
      };
    }

    case "search_requested": {
      const { requestId, sfen, consistency } = action.payload;
      const sessions = ensureSession(state.sessions, requestId);
      const s = sessions[requestId]!;
      return {
        ...state,
        sessions: {
          ...sessions,
          [requestId]: {
            ...s,
            requestId,
            querySfen: sfen,
            consistency,
          },
        },
      };
    }

    case "search_end": {
      const p = action.payload;
      // **無いセッションは作らない。** Rust は取り下げた検索でも終わりを emit するので
      // （`search/query_service.rs` は `break` した後で必ず `EVT_SEARCH_END` を出す）、
      // ここで作ると `clear_search` で捨てたセッションが**空のまま戻る**。
      // 戻った側を消す口はもう無い——画面はその rid を忘れている
      const s = state.sessions[p.requestId];
      if (!s) return state;

      const isCurrent = state.currentRequestId === p.requestId;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...state.sessions,
          [p.requestId]: {
            ...s,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "search_error": {
      const p = action.payload;
      // 終わりと同じ。捨てたセッションを失敗の記録で作り直さない
      const s = state.sessions[p.requestId];
      if (!s) return state;

      const isCurrent = state.currentRequestId === p.requestId;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...state.sessions,
          [p.requestId]: {
            ...s,
            error: p.message,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "clear_search": {
      // C-M4: rid 必須化。全削除は許可しない (他モーダル誤巻き込み防止)。
      const rid = action.payload.requestId;
      if (!state.sessions[rid]) return state;

      const next = { ...state.sessions };
      delete next[rid];

      const currentRequestId = state.currentRequestId === rid ? null : state.currentRequestId;

      return {
        ...state,
        isSearching: currentRequestId ? state.isSearching : false,
        currentRequestId,
        sessions: next,
      };
    }

    default:
      return state;
  }
}
