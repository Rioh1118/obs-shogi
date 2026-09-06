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

/** 同じ警告かを決める鍵。**直前との比較では足りない**（下の `appendWarn`）。 */
function warnKey(w: SearchState["warns"][number]) {
  return `${w.kind}\u0000${w.path}\u0000${w.message}`;
}

/**
 * 警告を積む。**同じものは複製せず、末尾へ動かす。**
 *
 * **直前の1件と比べるだけでは足りない。** 1回の再走査は読めない場所について
 * 最大3本（引き継げた／引き継げなかった／場所が分からない）を出し、そのあいだに
 * 棋譜1件ごとの警告も挟まる。次の再走査が同じ3本を出すとき、どれも直前とは
 * 別の1件なので**全部通る**——読めない場所を1つ放置したまま作業すると、
 * 数回の保存で枠が同じ文言の複製だけになり、棋譜の警告が一度も描かれなくなる。
 *
 * 末尾へ動かすのは、**新しさを保つため**。前に出た警告がまた出たなら、
 * それはいまも起きていることなので古い扱いにしない。
 *
 * **種類ごとに上限を持つ。** 総数だけで切ると、1回の再走査が棋譜1件ごとに出す
 * 警告が枠を独占し、場所の警告が消える。
 */
function appendWarn(warns: SearchState["warns"], next: SearchState["warns"][number]) {
  const key = warnKey(next);
  const withoutDup = warns.filter((w) => warnKey(w) !== key);
  const grown = [...withoutDup, next];
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

    case "index_warn":
      return { ...state, warns: appendWarn(state.warns, action.payload) };

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
