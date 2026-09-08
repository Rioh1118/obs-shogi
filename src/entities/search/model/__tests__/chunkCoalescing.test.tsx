// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { PositionHit, RequestId } from "@/entities/search/api/ids";
import type { SearchChunkPayload, SearchEndPayload } from "@/entities/search/api/events";
import type { SearchEventHandlers } from "@/entities/search/api/tauri";

/**
 * 到着したチャンクを溜めて、まとめて1回だけ state へ入れること。
 *
 * **数えるのはレンダの回数。** Rust は結果の件数ぶんチャンクを emit する
 * ので、1チャンク1レンダだと `filePathById` と一覧の平坦化を「件数 ÷ 区切り」回
 * やり直す。溜めれば、その回数は件数でなく経過時間で決まる。
 *
 * 回数は画面に出ないので、**人の目では追えない**。
 */

let handlers: SearchEventHandlers = {};
let listenCount = 0;

let nextRequestId = 0;
let searchPositionImpl: () => Promise<{ requestId: number }> = () =>
  Promise.resolve({ requestId: nextRequestId });

vi.mock("../../api/tauri", () => ({
  openProject: vi.fn().mockResolvedValue({ indexedCount: 0 }),
  listenSearchEvents: (h: SearchEventHandlers) => {
    handlers = h;
    listenCount += 1;
    return Promise.resolve(() => {});
  },
  // Rust は rid を単調に増やす（`QueryService::next_request_id`）
  searchPosition: () => searchPositionImpl(),
  cancelSearch: () => Promise.resolve(),
}));

const { PositionSearchProvider } = await import("../provider");
const { usePositionSearch } = await import("../usePositionSearch");

const RID: RequestId = 7;

function hitAt(fileId: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: fileId }, cursor: { tesuu: 1, forkPointers: [] } };
}

/** 一覧を読む側。読まないと平坦化が走らないので、現物と同じく毎レンダ引く */
let renders = 0;
let hitCount = 0;
let lastHits: PositionHit[] = [];
let getHits: (rid: number) => PositionHit[] = () => [];
let sessionIds: number[] = [];
let clearSearch: (rid: number) => void = () => {};
let isSearchingRequest: (rid: number) => boolean = () => false;
let searchPosition: (sfen: string) => Promise<unknown> = async () => undefined;

function Probe() {
  const {
    getHitsByRequestId,
    state,
    clearSearch: clear,
    searchPosition: search,
    isSearchingRequest: isSearching,
  } = usePositionSearch();
  renders += 1;
  getHits = getHitsByRequestId;
  clearSearch = clear;
  isSearchingRequest = isSearching;
  searchPosition = (sfen) => search({ sfen, consistency: "BestEffort", chunkSize: 300 });
  sessionIds = Object.keys(state.sessions).map(Number);
  lastHits = getHitsByRequestId(RID);
  hitCount = lastHits.length;
  return null;
}

const hitsOf = (rid: number) => getHits(rid).length;

/**
 * チャンクの中身が何回読まれたかを数える。
 *
 * 平坦化が増分なら合計は届いた件数に落ち着く。毎回作り直していれば、到着の
 * 回数ぶん二乗で伸びる（実測で n=100,000 のとき合計 836ms。
 * `.claude/reviews/2026-09-07-447-position-search-perf-r1.md` M-4）。**回数は
 * どこにも出ないので、これ以外に見る方法が無い。**
 */
let elementReads = 0;

function counting(hits: PositionHit[]): PositionHit[] {
  return new Proxy(hits, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) elementReads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function chunkOf(n: number, from: number): SearchChunkPayload {
  const chunk = Array.from({ length: n }, (_, i) => hitAt(from + i));
  return {
    requestId: RID,
    chunk: counting(chunk),
    files: chunk.map((h) => ({ fileId: h.occ.fileId, absPath: `/root/${h.occ.fileId}.kif` })),
  };
}

let view!: ReturnType<typeof render>;

async function mount() {
  await act(async () => {
    view = render(
      <PositionSearchProvider rootDir={null}>
        <Probe />
      </PositionSearchProvider>,
    );
  });
  renders = 0;
}

/**
 * チャンクを k 本、溜め時間を跨がずに届ける。
 *
 * **1本ずつ別の `act` で届ける。** 現物では1本1本が別の IPC のコールバックなので、
 * まとめて撃つと React の自動バッチが差を消してしまい、溜めていなくても
 * レンダは1回に見える
 */
function deliver(k: number) {
  for (let i = 0; i < k; i++) {
    act(() => {
      handlers.onSearchChunk?.(chunkOf(2, i * 2));
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers = {};
  listenCount = 0;
  renders = 0;
  hitCount = 0;
  elementReads = 0;
  nextRequestId = 0;
  searchPositionImpl = () => Promise.resolve({ requestId: nextRequestId });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("チャンクの合流", () => {
  test("10本届いても、state へ入るのは1回だけ", async () => {
    await mount();

    deliver(10);
    expect(renders).toBe(0);

    act(() => {
      vi.runAllTimers();
    });

    expect(hitCount).toBe(20);
    expect(renders).toBe(1);
  });

  /** 溜めた順は保つ。並べ替えは一覧の側の仕事で、ここで混ぜてはいけない */
  test("溜めた順のまま入る", async () => {
    await mount();

    deliver(3);
    act(() => {
      vi.runAllTimers();
    });

    expect(lastHits.map((h) => h.occ.fileId)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  /**
   * 終わりは溜め時間を待たない。待つと、まだ届いていない結果を抱えたまま
   * 一覧が「完了」と名乗る時間ができる
   */
  test("検索の終わりは、溜めたぶんを吐き出してから立つ", async () => {
    await mount();

    deliver(4);

    act(() => {
      handlers.onSearchEnd?.({ requestId: RID } satisfies SearchEndPayload);
    });

    expect(hitCount).toBe(8);

    // 吐き出し済みなので、あとからタイマが起きても何も増えない
    const rendersAfterEnd = renders;
    act(() => {
      vi.runAllTimers();
    });
    expect(renders).toBe(rendersAfterEnd);
    expect(hitCount).toBe(8);
  });

  /**
   * 溜め時間を跨いで届いた場合。**取り込みは末尾だけ**で、先頭から作り直さない。
   *
   * 10回に分けて2件ずつ届けたとき、作り直していれば 2+4+…+20 = 110 件ぶん読む。
   * 増分なら 20 件。件数が増えるほど差は二乗で開く。
   */
  test("溜め時間を跨いで届いても、平坦化は末尾だけ足す", async () => {
    await mount();

    for (let i = 0; i < 10; i++) {
      act(() => {
        handlers.onSearchChunk?.(chunkOf(2, i * 2));
      });
      act(() => {
        vi.runAllTimers();
      });
    }

    expect(hitCount).toBe(20);
    expect(elementReads).toBeLessThanOrEqual(25);
  });

  /**
   * 増分にすると、作業用の配列は同じものを伸ばし続けることになる。**それを直に
   * 返してはいけない**——呼び手の `useMemo` は参照で変化を見ているので、
   * 同じ配列のままだと新着ヒットが一覧に出なくなる
   */
  test("増えたら別の配列として渡す", async () => {
    let seen: unknown[] = [];
    await mount();

    act(() => {
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });
    act(() => {
      vi.runAllTimers();
    });
    seen = lastHits;
    const first = seen;

    act(() => {
      handlers.onSearchChunk?.(chunkOf(2, 2));
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(lastHits).not.toBe(first);
    expect(first.length).toBe(2);
    expect(lastHits.length).toBe(4);
  });

  /**
   * 溜めたまま畳まれたら、起こし手ごと消える。
   *
   * **「例外が出ないこと」では見張れない。** 外れた reducer への dispatch は
   * React が黙って捨てるので、タイマが残っていても通ってしまう。
   * 残っていないことを直接数える
   */
  test("畳まれたら溜め場ごと捨てる", async () => {
    await act(async () => {
      render(
        <PositionSearchProvider rootDir={null}>
          <Probe />
        </PositionSearchProvider>,
      );
    });

    deliver(3);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
  });

  /** 畳んだ後に届いたチャンクが、消えた溜め場へ積んでタイマを張り直さないこと */
  test("畳んだ後に届いたチャンクは積まない", async () => {
    await act(async () => {
      render(
        <PositionSearchProvider rootDir={null}>
          <Probe />
        </PositionSearchProvider>,
      );
    });

    cleanup();

    act(() => {
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("購読", () => {
  /**
   * **購読を張り直させない。** `listen` は IPC の往復を待つので、張り直しの隙間に
   * emit されたチャンクは誰にも届かない。**エラーは出ず、件数だけが減る。**
   *
   * 溜め場の起こし手を購読の effect が呼ぶ以上、それが `useCallback` のままだと
   * 依存に載る。載せた時点でこの形が作れてしまうので、ここで数える
   */
  test("チャンクが届いても描き直されても、購読は1回だけ", async () => {
    await mount();
    expect(listenCount).toBe(1);

    deliver(5);
    act(() => {
      vi.runAllTimers();
    });

    await act(async () => {
      view.rerender(
        <PositionSearchProvider rootDir={null}>
          <Probe />
        </PositionSearchProvider>,
      );
    });

    expect(listenCount).toBe(1);
  });
});

describe("検索の終わり", () => {
  /**
   * **`search_end` は在るセッションにしか効かない**（捨てたセッションを作り直さない
   * ため）。その結果、「検索が終わったこと」を受け取れる担保は
   * **`search_requested` がセッションを作っている1点だけ**になった。
   *
   * ここに門を足して「対称にする」改変を当てると、`search_begin` を取りこぼした回の
   * 終わりが捨てられ、**「検索中…」で永久に止まる**。エラーも出ない。
   */
  test("始まりを取りこぼしても、終わりは届く", async () => {
    await mount();

    nextRequestId = 3;
    await act(async () => {
      await searchPosition("dummy");
    });
    expect(isSearchingRequest(3)).toBe(true);

    // `search_begin` は撃たない（取りこぼした回）
    act(() => {
      handlers.onSearchEnd?.({ requestId: 3 } satisfies SearchEndPayload);
    });

    expect(isSearchingRequest(3)).toBe(false);
  });
});

describe("消えたセッション宛のチャンク", () => {
  /**
   * Rust の `open_project` は進行中の検索を1つもキャンセルしない
   * （`src-tauri/src/search/commands.rs`）。`open_start` がセッションを落とした後も
   * 同じ rid のチャンクが届くので、**入口で弾かないと `ensureSession` が
   * 消えたセッションを作り直す**——`currentRequestId` と `filePathById` が
   * 古い根のものへ戻る
   */
  test("根を開き直した後に届いた、前の検索のチャンクは捨てる", async () => {
    await mount();

    act(() => {
      handlers.onSearchBegin?.({ requestId: RID, stale: false });
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });

    // 根を開き直す（`open_start`）
    await act(async () => {
      view.rerender(
        <PositionSearchProvider rootDir="/ws">
          <Probe />
        </PositionSearchProvider>,
      );
    });

    // 取り下げの届いていない Rust が、まだ同じ rid で送ってくる
    act(() => {
      handlers.onSearchChunk?.(chunkOf(2, 2));
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(hitCount).toBe(0);
  });

  /**
   * **終わりも門を通す。** Rust は取り下げた検索でも `end` を emit する
   * （`query_service.rs` は `break` の後で必ず出す）ので、素通りさせると
   * `ensureSession` が捨てたセッションを**空のまま作り直す**。作り直された側を
   * 消す口はもう無い——画面はその rid を忘れている
   */
  test("捨てた検索の終わりが届いても、セッションは戻らない", async () => {
    await mount();

    act(() => {
      handlers.onSearchBegin?.({ requestId: RID, stale: false });
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(sessionIds).toEqual([RID]);

    act(() => {
      clearSearch(RID);
    });
    expect(sessionIds).toEqual([]);

    act(() => {
      handlers.onSearchEnd?.({ requestId: RID } satisfies SearchEndPayload);
    });

    expect(sessionIds).toEqual([]);
  });

  /** 始まりも同じ。捨てた rid の begin でセッションを作り直さない */
  test("捨てた検索の始まりが届いても、セッションは戻らない", async () => {
    await mount();

    act(() => {
      handlers.onSearchBegin?.({ requestId: RID, stale: false });
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      clearSearch(RID);
    });

    act(() => {
      handlers.onSearchBegin?.({ requestId: RID, stale: false });
    });

    expect(sessionIds).toEqual([]);
  });

  /**
   * 線は「見た中で最大の rid」に引き、それより手前は個別に覚えない
   * （`dead` を空にする）。**イベントで見た rid しか数えないと**、
   * `clear_search` に渡された rid が線を追い越して忘れられ、以後そのチャンクが通る
   */
  test("イベントを1つも見ていない検索でも、捨てたら線より後ろに残らない", async () => {
    await mount();

    // rid 8 の始まりだけを見た状態にする
    act(() => {
      handlers.onSearchBegin?.({ requestId: 8, stale: false });
    });

    // rid 9 は invoke だけ済んでいる（イベントはまだ1つも来ていない）
    nextRequestId = 9;
    await act(async () => {
      await searchPosition("dummy");
    });
    act(() => {
      clearSearch(9);
    });

    // 根を開き直す → 線が引かれ、`dead` は空になる
    await act(async () => {
      view.rerender(
        <PositionSearchProvider rootDir="/ws">
          <Probe />
        </PositionSearchProvider>,
      );
    });

    act(() => {
      handlers.onSearchChunk?.({ ...chunkOf(2, 0), requestId: 9 });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(hitsOf(9)).toBe(0);
  });

  /**
   * **番号が返る前に線が引かれた検索。** 線は「見えている rid の最大」で引くので、
   * invoke が飛んでいる最中の検索は数えられておらず、線の後ろに回ってしまう。
   * 通すと前の根の絶対パスが新しい root の `filePathById` に混ざる
   */
  test("番号が返る前に根を開き直された検索は、state に残らない", async () => {
    await mount();

    // 検索を投げる。まだ解決しない
    let settle!: (out: { requestId: number }) => void;
    searchPositionImpl = () => new Promise((resolve) => (settle = resolve));
    let launched!: Promise<unknown>;
    act(() => {
      launched = searchPosition("dummy");
    });

    // 待っている間に根を開き直す
    await act(async () => {
      view.rerender(
        <PositionSearchProvider rootDir="/ws">
          <Probe />
        </PositionSearchProvider>,
      );
    });

    // そこでやっと番号が返る
    await act(async () => {
      settle({ requestId: 12 });
      await launched;
    });

    act(() => {
      handlers.onSearchChunk?.({ ...chunkOf(2, 0), requestId: 12 });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(sessionIds).toEqual([]);
    expect(hitsOf(12)).toBe(0);
  });

  /** 線より後に始まった検索は通る。**弾くのは古い rid だけ** */
  test("開き直した後に始まった検索は通る", async () => {
    await mount();

    act(() => {
      handlers.onSearchBegin?.({ requestId: RID, stale: false });
      handlers.onSearchChunk?.(chunkOf(2, 0));
    });

    await act(async () => {
      view.rerender(
        <PositionSearchProvider rootDir="/ws">
          <Probe />
        </PositionSearchProvider>,
      );
    });

    const nextRid = RID + 1;
    act(() => {
      handlers.onSearchBegin?.({ requestId: nextRid, stale: false });
      handlers.onSearchChunk?.({ ...chunkOf(2, 0), requestId: nextRid });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(hitsOf(nextRid)).toBe(2);
  });
});
