import type { Dispatch } from "react";

import type { SearchChunkPayload } from "../api/events";
import type { FilePathEntry, PositionHit, RequestId } from "../api/ids";
import type { Action } from "./types";

/**
 * 届いたチャンクを溜めておく時間（ms）。
 *
 * **1チャンク1レンダにしない。** Rust は `yield_now` を挟んで実時間に散らして
 * emit する（`src-tauri/src/search/query_service.rs`）ので、チャンクは結果の
 * 件数ぶん飛んでくる。区切りを決めているのは要求する側
 * （`features/position-search/ui/PositionSearchModal.tsx` の `chunkSize`）で、
 * **ここは区切りの値を知らない**。1回ごとに state を作り直すと、10万件の
 * `filePathById` と一覧の平坦化を「件数 ÷ 区切り」回やり直す。
 *
 * 溜めると、その回数が**件数でなく経過時間**で決まるようになる。50ms は
 * 「結果が育っていくのが見える」ことと「回数の上限（20回/秒）」の折り合い。
 * 検索の完了・失敗はここを待たずに吐き出すので、終わりが遅れることはない。
 */
const CHUNK_FLUSH_MS = 50;

/** まだ dispatch していない到着ぶん */
type PendingChunks = { chunks: PositionHit[][]; files: FilePathEntry[] };

/**
 * 溜め場と、そこへ入れてよいかの門。
 *
 * **溜めたぶんを捨てるだけでは門にならない。** `open_start` はセッションを全部
 * 落とすが、Rust の `open_project` は進行中の検索を1つもキャンセルしない
 * （`src-tauri/src/search/commands.rs`）。その後も同じ rid のチャンクが届くので、
 * 入口で弾かないと `ensureSession` が消えたセッションを作り直し、
 * `currentRequestId` と `filePathById` が**古い根のものへ戻る**。
 *
 * 線は「これより前の rid は受け取らない」で引く。rid は Rust 側で単調に増える
 * （`QueryService::next_request_id`）ので、線より後に始まった検索は必ず通る。
 * **通すのが既定**なので、`search_begin` を1発取りこぼしても結果が黙って
 * 0件になることはない。
 */
export type ChunkBufferApi = {
  /** 1つ届いた。受け取ってよければ溜める */
  enqueue: (p: SearchChunkPayload) => void;
  /** 溜めたぶんを吐き出す。待ち時間は待たない */
  flush: () => void;
  /**
   * 以後この検索のチャンクを受け取らない。溜めたぶんも**吐き出さずに**捨てる。
   * `requestId` を省くと「いま在る検索は全部」——`open_start` がそれに当たる。
   */
  stopAccepting: (requestId?: RequestId) => void;
  /** 検索が1つ始まった。線を引く位置に要る */
  noteRequest: (requestId: RequestId) => void;
  /**
   * いま在る検索を全部止めた回数。**invoke が飛んでいる間に線が引かれたか**を
   * 呼び手が確かめるのに使う（rid はまだ返っていないので、線には数えられない）
   */
  generation: () => number;
  /**
   * この検索をまだ受け取ってよいか。**通すのが既定**（知らない rid は通る）。
   *
   * ここを通すのは `search_chunk` と `search_begin` の2つだけ。
   * `search_end` / `search_error` は**通さない**——通すのが既定である以上、
   * セッションを作りうる口をここでは守れないので、reducer 側で
   * 「在るセッションにしか効かない」で守る。
   * `search_requested` はフロントが自分で出す口で、rid が返るまで溜め場から
   * 見えないため門では守れない（`generation` のほうで見張る）。
   */
  isAccepting: (requestId: RequestId) => boolean;
  /** 受け取りを開ける／閉じる。effect の setup と cleanup で対にする */
  activate: () => void;
  deactivate: () => void;
};

/**
 * **起こし手ごと1つの object に閉じる。**
 *
 * 購読の effect（`listenSearchEvents`）はここから `enqueue` と `flush` を呼ぶ。
 * 起こし手が `useCallback` のままだと、その effect の依存に載せることになり、
 * **同一性が変われば tauri の購読が張り直る**。`listen` は IPC の往復を待つので、
 * 張り直しの隙間に emit されたチャンクは誰にも届かず、エラーも出ずに件数だけ減る。
 * 同一性の変わらない object に入れておけば、その形が作れない。
 *
 * `dispatch` は `useReducer` が返すもので、React が同一性を保証している。
 */
export function createChunkBuffer(dispatch: Dispatch<Action>): ChunkBufferApi {
  const pending = new Map<RequestId, PendingChunks>();
  /**
   * 名指しで捨てた rid。入れる口は2つ——`clear_search` と、番号が返る前に線が
   * 引かれた起動（`model/provider.tsx` の `searchPosition`）。
   * 線より後のものだけがここに要る
   */
  const dead = new Set<RequestId>();

  let timer: number | null = null;
  let active = true;
  /** `open_start` が引いた線。**これより前**の rid は受け取らない */
  let firstLiveRid: RequestId = 1;
  /** 見た中で最大の rid。線を引く位置に使う */
  let maxSeenRid: RequestId = 0;
  /** 線を引き直した回数 */
  let generation = 0;

  const cancelTimer = () => {
    if (timer == null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (pending.size === 0) return;

    // **溜め場を先に空にする**——dispatch の最中に届いたチャンクは次の回のもので、
    // 後から消すと落ちる
    const batches = [...pending];
    pending.clear();

    for (const [requestId, { chunks, files }] of batches) {
      dispatch({ type: "search_chunks", payload: { requestId, chunks, files } });
    }
  };

  const noteRequest = (requestId: RequestId) => {
    if (requestId > maxSeenRid) maxSeenRid = requestId;
  };

  const isAccepting = (requestId: RequestId) =>
    active && requestId >= firstLiveRid && !dead.has(requestId);

  return {
    flush,
    noteRequest,
    isAccepting,
    generation: () => generation,

    enqueue: (p) => {
      noteRequest(p.requestId);
      if (!isAccepting(p.requestId)) return;

      const cur = pending.get(p.requestId);
      if (cur) {
        cur.chunks.push(p.chunk);
        for (const f of p.files) cur.files.push(f);
      } else {
        pending.set(p.requestId, { chunks: [p.chunk], files: [...p.files] });
      }

      if (timer == null) timer = window.setTimeout(flush, CHUNK_FLUSH_MS);
    },

    stopAccepting: (requestId) => {
      if (requestId == null) {
        pending.clear();
        generation += 1;
        // 見えている rid はここで全部止める。**ここに数えられていない rid がある**
        // ——invoke が飛んでいて番号がまだ返っていない検索。それは線の後ろに
        // 回ってしまうので、呼び手が `generation` で見張る
        firstLiveRid = maxSeenRid + 1;
        // 線より前は `firstLiveRid` が受け持つので、個別に覚えておく必要は無い
        dead.clear();
      } else {
        pending.delete(requestId);
        if (requestId >= firstLiveRid) dead.add(requestId);
      }

      if (pending.size === 0) cancelTimer();
    },

    activate: () => {
      active = true;
    },

    deactivate: () => {
      cancelTimer();
      pending.clear();
      active = false;
    },
  };
}
