import { describe, expect, it } from "vitest";

import type { IndexStatePayload } from "@/entities/search/api/events";
import type { PositionHit } from "@/entities/search/api/ids";
import { initialState, reducer } from "../reducer";
import type { SearchState } from "../types";

const RID = 7;

const indexPayload = (over: Partial<IndexStatePayload> = {}): IndexStatePayload => ({
  state: "Updating",
  dirtyCount: 0,
  indexedFiles: 0,
  totalFiles: 0,
  scanFailed: false,
  partiallyUnreadable: false,
  ...over,
});

const hit = (fileId: number): PositionHit => ({
  occ: { fileId, gen: 1, nodeId: 1 },
  cursor: { tesuu: 0, forkPointers: [] },
});

function withBegunSearch(state: SearchState = initialState, requestId = RID): SearchState {
  return reducer(state, { type: "search_begin", payload: { requestId, stale: false } });
}

function withChunk(state: SearchState, files = [{ fileId: 1, absPath: "/ws/a.kif" }]) {
  return reducer(state, {
    type: "search_chunks",
    payload: { requestId: RID, chunks: [[hit(1)]], files },
  });
}

describe("索引の状態", () => {
  it("届いた欄を写す", () => {
    const payload = indexPayload({
      state: "Building",
      dirtyCount: 2,
      indexedFiles: 3,
      totalFiles: 9,
      scanFailed: true,
      partiallyUnreadable: true,
    });

    const { index } = reducer(initialState, { type: "index_state", payload });

    expect(index).toMatchObject(payload);
  });

  /** `Ready` のときの `index_progress` は来ないことがあり、進捗が途中の数で残る */
  it("Ready に着いたら処理済みの数を対象の数へ揃える", () => {
    const payload = indexPayload({ state: "Ready", totalFiles: 9 });

    expect(reducer(initialState, { type: "index_state", payload }).index.doneFiles).toBe(9);
  });

  it("進行中は処理済みの数を対象の数で切り詰める", () => {
    const progressed = reducer(initialState, {
      type: "index_progress",
      payload: { currentPath: "/a", doneFiles: 8, totalFiles: 10 },
    });

    const payload = indexPayload({ totalFiles: 5 });
    expect(reducer(progressed, { type: "index_state", payload }).index.doneFiles).toBe(5);
  });
});

describe("索引の進捗", () => {
  const progress = (currentPath: string, doneFiles: number, totalFiles: number) => ({
    type: "index_progress" as const,
    payload: { currentPath, doneFiles, totalFiles },
  });

  it("空のパスでは前のパスを残す", () => {
    const first = reducer(initialState, progress("/a", 1, 3));
    const second = reducer(first, progress("", 2, 3));

    expect(second.index.currentPath).toBe("/a");
    expect(second.index.doneFiles).toBe(2);
  });

  it("対象の数は index_state が決めたものを優先する", () => {
    const stated = reducer(initialState, {
      type: "index_state",
      payload: indexPayload({ totalFiles: 5 }),
    });

    expect(reducer(stated, progress("/a", 1, 3)).index.totalFiles).toBe(5);
    expect(reducer(initialState, progress("/a", 1, 3)).index.totalFiles).toBe(3);
  });
});

describe("索引を開く", () => {
  it("検索とパスの表を空にして、警告と索引の状態は残す", () => {
    const warn = { kind: "place" as const, path: "/ws", message: "読めません" };
    const searched = withChunk(withBegunSearch());
    const warned = reducer(searched, { type: "index_warn", payload: warn });
    const failed = reducer(warned, { type: "open_error", payload: { message: "失敗" } });

    const opened = reducer(failed, { type: "open_start" });

    expect(opened.sessions).toEqual({});
    expect(opened.filePathById).toEqual({});
    expect(opened.openError).toBeNull();
    expect(opened.warns).toEqual([warn]);
    expect(opened.index).toBe(failed.index);
  });

  it("失敗の文を残す", () => {
    const failed = reducer(initialState, { type: "open_error", payload: { message: "失敗" } });

    expect(failed.openError).toBe("失敗");
  });
});

describe("検索のセッション", () => {
  it("始まりで作り、古いかどうかを写す", () => {
    const begun = reducer(initialState, {
      type: "search_begin",
      payload: { requestId: RID, stale: true },
    });

    expect(begun.sessions[RID]).toMatchObject({
      requestId: RID,
      stale: true,
      isDone: false,
      error: null,
      chunks: [],
    });
  });

  it("始まりで前の完了と失敗を外す", () => {
    const failed = reducer(withBegunSearch(), {
      type: "search_error",
      payload: { requestId: RID, message: "失敗" },
    });

    expect(withBegunSearch(failed).sessions[RID]).toMatchObject({ isDone: false, error: null });
  });

  it("番号が返った時点でセッションが在る", () => {
    const requested = reducer(initialState, {
      type: "search_requested",
      payload: { requestId: RID },
    });

    expect(requested.sessions[RID]).toMatchObject({ isDone: false, chunks: [] });
  });

  /** 番号の応答より始まりのイベントが先に届くことがある */
  it("番号が返っても、先に届いた結果を消さない", () => {
    const streamed = withChunk(withBegunSearch());

    const requested = reducer(streamed, {
      type: "search_requested",
      payload: { requestId: RID },
    });

    expect(requested.sessions[RID].chunks).toHaveLength(1);
  });

  it("結果は届いた順に積み、パスの表へ足す", () => {
    const first = withChunk(withBegunSearch());
    const second = withChunk(first, [{ fileId: 2, absPath: "/ws/b.kif" }]);

    expect(second.sessions[RID].chunks).toHaveLength(2);
    expect(second.filePathById).toEqual({ 1: "/ws/a.kif", 2: "/ws/b.kif" });
  });

  it("パスの表が変わらなければ同じ表を返す", () => {
    const first = withChunk(withBegunSearch());

    expect(withChunk(first).filePathById).toBe(first.filePathById);
    expect(withChunk(first, []).filePathById).toBe(first.filePathById);
  });

  it("同じ番号のパスが変わったら置き換える", () => {
    const first = withChunk(withBegunSearch());
    const second = withChunk(first, [{ fileId: 1, absPath: "/ws/moved.kif" }]);

    expect(second.filePathById[1]).toBe("/ws/moved.kif");
  });

  it("終わりで完了にし、届いた結果を残す", () => {
    const ended = reducer(withChunk(withBegunSearch()), {
      type: "search_end",
      payload: { requestId: RID },
    });

    expect(ended.sessions[RID]).toMatchObject({ isDone: true, error: null });
    expect(ended.sessions[RID].chunks).toHaveLength(1);
  });

  it("失敗で完了にし、文と届いた結果を残す", () => {
    const failed = reducer(withChunk(withBegunSearch()), {
      type: "search_error",
      payload: { requestId: RID, message: "失敗" },
    });

    expect(failed.sessions[RID]).toMatchObject({ isDone: true, error: "失敗" });
    expect(failed.sessions[RID].chunks).toHaveLength(1);
  });

  /** Rust は取り下げた検索でも結果を流した後なら終わりを emit する。作ると捨てたものが空で戻る */
  it.each([
    { type: "search_end", payload: { requestId: RID } },
    { type: "search_error", payload: { requestId: RID, message: "失敗" } },
  ] as const)("無いセッションへの $type は何も変えない", (action) => {
    expect(reducer(initialState, action)).toBe(initialState);
  });

  it("捨てるのは指定した番号だけ", () => {
    const both = withBegunSearch(withBegunSearch(initialState, 1), 2);

    const cleared = reducer(both, { type: "clear_search", payload: { requestId: 1 } });

    expect(Object.keys(cleared.sessions)).toEqual(["2"]);
  });

  it("無い番号を捨てても何も変えない", () => {
    const action = { type: "clear_search", payload: { requestId: RID } } as const;

    expect(reducer(initialState, action)).toBe(initialState);
  });
});
