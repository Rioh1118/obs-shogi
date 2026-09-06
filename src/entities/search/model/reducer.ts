import type { RequestId } from "../api/ids";
import type { Action, FilePathById, MergeFilesInput, SearchSession, SearchState } from "./types";

export const initialState: SearchState = {
  index: {
    state: "Empty",
    dirtyCount: 0,
    scanFailed: false,
    partiallyUnreadable: false,
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

/** 覚えておく警告の総数。**種類ごとの内訳は下の `PLACE_KEPT`。** */
const WARNS_KEPT = 200;

/**
 * 場所の警告として覚えておく数。
 *
 * **総数だけで切ると、場所の警告は必ず落ちる。** 1回の再走査は棋譜1件ごとに
 * 警告を出しうるので、読めない場所が1つあるワークスペースでは
 * ファイル単位の警告が総数の枠を独占する——落ちるのは
 * 「ワークスペースを読めません」のような、**利用者が次にすることを含んだ
 * 唯一の文言**のほう。
 */
const PLACE_KEPT = 20;

/**
 * 警告を積む。**種類ごとに上限を持つ。**
 *
 * 並べ替えはしない——並びは届いた順のままで、どれを描くかは `pickWarns` が決める。
 */
function appendWarn(warns: SearchState["warns"], next: SearchState["warns"][number]) {
  const grown = [...warns, next];
  if (grown.length <= WARNS_KEPT) return grown;

  // **末尾から数える形で書かない。** `slice(-n)` は `n` が 0 のとき
  // `slice(-0)` ＝ `slice(0)` になり、**1件も残さないつもりが全件残る**
  const allPlaces = grown.filter((w) => w.kind === "place");
  const places = allPlaces.slice(Math.max(0, allPlaces.length - PLACE_KEPT));

  const allFiles = grown.filter((w) => w.kind !== "place");
  const fileSlots = Math.max(0, WARNS_KEPT - places.length);
  const files = allFiles.slice(Math.max(0, allFiles.length - fileSlots));

  const keep = new Set([...places, ...files]);
  return grown.filter((w) => keep.has(w));
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
          scanFailed: p.scanFailed,
          partiallyUnreadable: p.partiallyUnreadable,
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

    case "index_warn": {
      // **同じ警告を積み増さない。** 読めない場所が1つあると、ワークスペースで
      // ファイルを保存するたびの再走査が毎回同じ1件を積む。枠は5つしか無いので、
      // 数回の保存で**同じ文言が枠を埋め尽くし**、後から来る棋譜1件ごとの警告が
      // 一度も描かれなくなる（`pickWarns` は場所を先に取る）
      const last = state.warns[state.warns.length - 1];
      if (
        last &&
        last.kind === action.payload.kind &&
        last.path === action.payload.path &&
        last.message === action.payload.message
      ) {
        return state;
      }
      return { ...state, warns: appendWarn(state.warns, action.payload) };
    }

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

    case "search_chunk": {
      const p = action.payload;
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
            chunks: [...s.chunks, p.chunk],
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
      const sessions = ensureSession(state.sessions, p.requestId);
      const s = sessions[p.requestId]!;
      const isCurrent = state.currentRequestId === p.requestId;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
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
      const sessions = ensureSession(state.sessions, p.requestId);
      const s = sessions[p.requestId]!;
      const isCurrent = state.currentRequestId === p.requestId;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
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
