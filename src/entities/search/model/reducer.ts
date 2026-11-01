import type { IndexWarnPayload } from "../api/events";
import type { FilePathEntry, RequestId } from "../api/ids";
import type { Action, FilePathById, SearchSession, SearchState } from "./types";

/**
 * `state.sessions` を落とすアクション。`sessions` を消す `case` を足したらここにも足す。
 * 落とす手順は `model/provider.tsx` の `dropSearch` が持つ。
 */
export type DropSearchAction = Extract<Action, { type: "open_start" | "clear_search" }>;

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

  openError: null,

  sessions: {},
};

function sessionOrNew(sessions: SearchState["sessions"], requestId: RequestId): SearchSession {
  return sessions[requestId] ?? { requestId, stale: false, isDone: false, error: null, chunks: [] };
}

/**
 * セッションを完了にする。無いセッションは作らない。
 *
 * Rust は取り下げた検索でも、結果を流し始めていれば終わりを emit する
 * （`search/query_service.rs` の `run_search`）。ここで作ると `clear_search` で捨てた
 * セッションが空のまま戻り、画面はその rid を忘れているので消す経路が無い。
 */
function finishSession(
  state: SearchState,
  requestId: RequestId,
  error: string | null,
): SearchState {
  const session = state.sessions[requestId];
  if (!session) return state;
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [requestId]: { ...session, isDone: true, error: error ?? session.error },
    },
  };
}

function mergeFiles(base: FilePathById, files: FilePathEntry[]): FilePathById {
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

/** 覚えておく警告の総数 */
const WARNS_KEPT = 200;

/**
 * 場所の警告として覚えておく数。
 *
 * 総数だけで切ると、再走査が棋譜1件ごとに出す警告が枠を埋め、場所の警告が消える。
 * 消えるのは「ワークスペースを読めませんでした」のように、利用者が次にすることを含む文言のほう。
 */
const PLACE_KEPT = 20;

function warnKey(w: IndexWarnPayload) {
  return `${w.kind}\u0000${w.path}\u0000${w.message}`;
}

/**
 * 警告を積む。同じ警告は複製せず、末尾へ動かす。
 *
 * 全件と比べるのは、再走査が読めない場所について最大3本を出し、その間に棋譜の警告も挟まるため。
 * 直前との比較だけだと同じ文言が保存のたびに積まれ、数回で枠が埋まる。
 *
 * 末尾へ動かすのは、また出た警告はいまも起きていることだから。
 */
function appendWarn(warns: IndexWarnPayload[], next: IndexWarnPayload) {
  const key = warnKey(next);
  const withoutDup = warns.filter((w) => warnKey(w) !== key);
  const grown = [...withoutDup, next];
  if (grown.length <= WARNS_KEPT) return grown;

  // `slice(-n)` と書かない。`n` が 0 だと `slice(0)` になり全件が残る
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
          // `Ready` のときの `index_progress` は来ないことがあるので揃える
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

    // 開くのは起動と根が変わるときで、持っている警告は前の根の絶対パスを指す
    case "open_start":
      return { ...state, openError: null, filePathById: {}, sessions: {}, warns: [] };

    case "open_error":
      return { ...state, openError: action.payload.message };

    case "search_begin": {
      const { requestId, stale } = action.payload;
      const session = sessionOrNew(state.sessions, requestId);
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [requestId]: { ...session, stale, isDone: false, error: null },
        },
      };
    }

    case "search_chunks": {
      const { requestId, chunks, files } = action.payload;
      const session = sessionOrNew(state.sessions, requestId);
      // 配列のまま積む。平らにするのは `flattenHits`
      return {
        ...state,
        filePathById: mergeFiles(state.filePathById, files),
        sessions: {
          ...state.sessions,
          [requestId]: { ...session, chunks: [...session.chunks, ...chunks] },
        },
      };
    }

    case "search_requested": {
      const { requestId } = action.payload;
      return {
        ...state,
        sessions: { ...state.sessions, [requestId]: sessionOrNew(state.sessions, requestId) },
      };
    }

    case "search_end":
      return finishSession(state, action.payload.requestId, null);

    case "search_error":
      return finishSession(state, action.payload.requestId, action.payload.message);

    case "clear_search": {
      const rid = action.payload.requestId;
      if (!state.sessions[rid]) return state;

      const sessions = { ...state.sessions };
      delete sessions[rid];
      return { ...state, sessions };
    }
  }
}
