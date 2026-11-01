// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { PositionHit, RequestId } from "@/entities/search/api/ids";
import type { SearchChunkPayload } from "@/entities/search/api/events";
import type { Action } from "../types";
import { createChunkBuffer } from "../chunkBuffer";

/**
 * `firstLiveRid` の進め方そのものを、React 抜きで突く。
 *
 * `chunkCoalescing.test.tsx` は provider を描画して同じ機構を見ているが、
 * あちらが見張るのは「レンダの回数が件数で伸びないこと」。どの rid を通し、
 * どれを弾くかはここで固定する——描画とフェイクタイマー越しだと、境界を1つずつ
 * 動かせない。
 */

const FLUSH_MS = 50;

function hitAt(fileId: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: fileId }, cursor: { tesuu: 1, forkPointers: [] } };
}

function chunkOf(requestId: RequestId): SearchChunkPayload {
  return { requestId, chunk: [hitAt(requestId)], files: [] };
}

function setup() {
  const dispatched: Action[] = [];
  const buffer = createChunkBuffer((a) => dispatched.push(a));
  buffer.activate();
  return { dispatched, buffer };
}

/** 吐き出されたチャンクの rid を並べる */
const ridsOf = (dispatched: Action[]) =>
  dispatched.flatMap((a) => (a.type === "search_chunks" ? [a.payload.requestId] : []));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createChunkBuffer", () => {
  test("溜めてから、待ち時間ぶん経ったところで1回だけ吐き出す", () => {
    const { dispatched, buffer } = setup();

    buffer.enqueue(chunkOf(1));
    buffer.enqueue(chunkOf(1));
    expect(dispatched).toHaveLength(0);

    vi.advanceTimersByTime(FLUSH_MS);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: "search_chunks", payload: { requestId: 1 } });
  });

  test("吐き出しは待ち時間を待たずに呼べる", () => {
    const { dispatched, buffer } = setup();

    buffer.enqueue(chunkOf(1));
    buffer.flush();

    expect(ridsOf(dispatched)).toEqual([1]);
  });

  /** 明示的に捨てた検索。`firstLiveRid` より後ろでも通さない */
  test("捨てた rid は通さない", () => {
    const { dispatched, buffer } = setup();

    buffer.noteRequest(5);
    buffer.stopAccepting(5);
    buffer.enqueue(chunkOf(5));
    vi.advanceTimersByTime(FLUSH_MS);

    expect(ridsOf(dispatched)).toEqual([]);
    expect(buffer.isAccepting(5)).toBe(false);
  });

  /**
   * `open_start` が進める下限。通すのは `requestId >= firstLiveRid` で、下限は
   * `firstLiveRid = maxSeenRid + 1` で進める。進めた時点で見えていた rid は、
   * その rid 自身も含めて止まる。
   *
   * `+ 1` を落とすと、開き直す直前に始まった検索が1本だけ生き残る。
   */
  test("いま在るものを全部止めると、その時点までの rid は1つも通らない", () => {
    const { dispatched, buffer } = setup();

    buffer.noteRequest(8);
    buffer.stopAccepting();

    buffer.enqueue(chunkOf(8));
    vi.advanceTimersByTime(FLUSH_MS);
    expect(ridsOf(dispatched)).toEqual([]);
    expect(buffer.isAccepting(8)).toBe(false);

    // `firstLiveRid` より後に始まったものは通る
    expect(buffer.isAccepting(9)).toBe(true);
    buffer.enqueue(chunkOf(9));
    vi.advanceTimersByTime(FLUSH_MS);
    expect(ridsOf(dispatched)).toEqual([9]);
  });

  /**
   * 通すのが既定。`noteRequest` を一度も通っていない rid でも
   * 通る——`search_begin` を1発取りこぼしただけで結果が黙って0件にならないこと
   */
  test("一度も知らせていない rid でも、線が引かれていなければ通る", () => {
    const { dispatched, buffer } = setup();

    buffer.enqueue(chunkOf(42));
    vi.advanceTimersByTime(FLUSH_MS);

    expect(ridsOf(dispatched)).toEqual([42]);
  });

  test("止めたら、以後は積まずタイマも張らない", () => {
    const { dispatched, buffer } = setup();

    buffer.deactivate();
    buffer.enqueue(chunkOf(1));

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(dispatched).toHaveLength(0);
  });

  /** 畳んで張り直す経路（StrictMode の二重マウント）で、閉じたまま残らないこと */
  test("止めたあと開け直せば、また積む", () => {
    const { dispatched, buffer } = setup();

    buffer.deactivate();
    buffer.activate();
    buffer.enqueue(chunkOf(1));
    vi.advanceTimersByTime(FLUSH_MS);

    expect(ridsOf(dispatched)).toEqual([1]);
  });

  /** 止めるときは溜めたぶんも捨てる。吐き出さない */
  test("止めると、溜めていたぶんは吐き出さずに消える", () => {
    const { dispatched, buffer } = setup();

    buffer.enqueue(chunkOf(1));
    buffer.deactivate();
    buffer.activate();
    vi.advanceTimersByTime(FLUSH_MS);

    expect(dispatched).toHaveLength(0);
  });

  /** 別のチャンクに載ったファイルを落とすと、そのヒットのパスが引けず開けない */
  test("待ち時間の中で続けて届いたファイルも全部渡す", () => {
    const { buffer, dispatched } = setup();
    const entry = (fileId: number) => ({ fileId, absPath: `/ws/${fileId}.kif` });

    buffer.enqueue({ requestId: 1, chunk: [], files: [entry(1)] });
    buffer.enqueue({ requestId: 1, chunk: [], files: [entry(2)] });
    buffer.flush();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "search_chunks",
      payload: { files: [entry(1), entry(2)] },
    });
  });

  test("溜めた分を全部捨てたらタイマも止める", () => {
    const { buffer } = setup();

    buffer.enqueue({ requestId: 1, chunk: [], files: [] });
    expect(vi.getTimerCount()).toBe(1);

    buffer.stopAccepting(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
