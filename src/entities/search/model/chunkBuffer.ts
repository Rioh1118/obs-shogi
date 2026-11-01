import type { Dispatch } from "react";

import type { SearchChunkPayload } from "../api/events";
import type { FilePathEntry, PositionHit, RequestId } from "../api/ids";
import type { Action } from "./types";

/**
 * 届いたチャンクを溜めておく時間（ms）。
 *
 * Rust はチャンクを実時間に散らして emit するので（`src-tauri/src/search/query_service.rs` の
 * `yield_now`）、1つごとに state を作り直すと `filePathById` と一覧の平坦化を
 * 「件数 ÷ `chunkSize`」回やり直す。溜めると回数が経過時間で決まる。
 *
 * 50ms は結果が育つのが見えることと、毎秒20回の上限の折り合い。検索の終わりと失敗は
 * これを待たずに `flush` する。
 */
const CHUNK_FLUSH_MS = 50;

/** まだ dispatch していない到着ぶん */
type PendingChunks = { chunks: PositionHit[][]; files: FilePathEntry[] };

/**
 * 届いたチャンクを溜める入れ物と、受け取ってよいかの判定。
 *
 * 入口で断るのは、Rust の `open_project` が進行中の検索を取り消さないため。`open_start` で
 * セッションを落とした後も同じ rid のチャンクが届き、通すと `sessionOrNew` がセッションを
 * 作り直して、`filePathById` が古い根のものへ戻る。
 *
 * rid は Rust が単調に増やす（`QueryService::next_request_id`）ので、`firstLiveRid` より前を
 * 断れば、開き直しの後に始まった検索は断られない。知らない rid も通すので、`search_begin` を
 * 取りこぼしても結果は消えない。
 */
export type ChunkBuffer = {
  /** 受け取ってよければ溜める */
  enqueue: (p: SearchChunkPayload) => void;
  /** 溜めた分を待たずに dispatch する */
  flush: () => void;
  /**
   * 以後この検索のチャンクを断り、溜めた分は dispatch せずに捨てる。
   * `requestId` を省くと、いま見えている全部の検索を対象にする。
   */
  stopAccepting: (requestId?: RequestId) => void;
  /** 見えた rid を数える。`stopAccepting()` が `firstLiveRid` を引く位置に使う */
  noteRequest: (requestId: RequestId) => void;
  /** 全部の検索を止めた回数。番号を待つ間に止められたかを呼び手が確かめる */
  generation: () => number;
  /**
   * この検索をまだ受け取ってよいかを返す。知らない rid には真を返す。
   *
   * 通すのは `search_chunks` と `search_begin` だけ。`search_end` と `search_error` は
   * reducer が在るセッションにしか効かせないので通さない。`search_requested` は番号が
   * 返るまで判定できないので `generation` で見張る。
   */
  isAccepting: (requestId: RequestId) => boolean;
  /** 受け取りを開ける。effect の setup で呼ぶ */
  activate: () => void;
  /** 受け取りを閉じ、溜めた分を捨てる。effect の cleanup で呼ぶ */
  deactivate: () => void;
};

/**
 * `ChunkBuffer` を作る。
 *
 * 状態を1つの object に閉じるのは、購読の effect の依存に載せても同一性が変わらないようにするため。
 * 変わると購読が張り直り、`listen` の IPC の往復の隙間に emit されたチャンクが黙って失われる。
 */
export function createChunkBuffer(dispatch: Dispatch<Action>): ChunkBuffer {
  const pending = new Map<RequestId, PendingChunks>();
  /**
   * 名指しで捨てた rid。`clearSearch` と、番号が返る前に根が開き直された起動
   * （`model/provider.tsx` の `searchPosition`）が入れる。`firstLiveRid` より後のものだけを持つ。
   */
  const droppedRids = new Set<RequestId>();

  let timer: number | null = null;
  let active = true;
  /** これより前の rid は受け取らない。`stopAccepting()` が進める */
  let firstLiveRid: RequestId = 1;
  let maxSeenRid: RequestId = 0;
  let generation = 0;

  const cancelTimer = () => {
    if (timer == null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (pending.size === 0) return;

    // 先に空にする。後から消すと、dispatch の最中に届いたチャンクが消える
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
    active && requestId >= firstLiveRid && !droppedRids.has(requestId);

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
        // 番号を待っている検索はここに数えられないので、呼び手が `generation` で見張る
        firstLiveRid = maxSeenRid + 1;
        // `firstLiveRid` より前は個別に覚えなくてよい
        droppedRids.clear();
      } else {
        pending.delete(requestId);
        if (requestId >= firstLiveRid) droppedRids.add(requestId);
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
