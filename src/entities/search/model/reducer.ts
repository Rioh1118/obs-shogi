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
  return (
    sessions[requestId] ?? { requestId, stale: false, isDone: false, error: null, chunks: [] }
  );
}

/** 無いセッションは作らない。 */
function finishSession(state: SearchState, requestId: RequestId, error: string | null) {
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
          // `Ready` に着いた回の `index_progress` が来ないことがあるので、ここで揃える
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
      return { ...state, openError: null, filePathById: {}, sessions: {} };

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
      // chunk は配列のまま追加。フラット化は consumer 側で償却 O(n)
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

    // **無いセッションは作らない。** Rust は取り下げた検索でも終わりを emit するので
    // （`search/query_service.rs` は `break` した後で必ず `EVT_SEARCH_END` を出す）、
    // ここで作ると `clear_search` で捨てたセッションが**空のまま戻る**。
    // 戻った側を消す経路はもう無い——画面はその rid を忘れている
    case "search_end":
      return finishSession(state, action.payload.requestId, null);

    // 終わりと同じ。捨てたセッションを失敗の記録で作り直さない
    case "search_error":
      return finishSession(state, action.payload.requestId, action.payload.message);

    case "clear_search": {
      // rid を必須にする。全削除を許すと、別のモーダルが見ている検索まで巻き込む。
      const rid = action.payload.requestId;
      if (!state.sessions[rid]) return state;

      const sessions = { ...state.sessions };
      delete sessions[rid];
      return { ...state, sessions };
    }
  }
}
