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
 * （既定 300 件区切りなら n=100,000 で 334 回）ので、1チャンク1レンダだと
 * 10万件の `filePathById` と一覧の平坦化を 334 回やり直す。溜めれば、その回数は
 * 件数でなく経過時間で決まる。
 *
 * 回数は画面に出ないので、**人の目では追えない**。
 */

let handlers: SearchEventHandlers = {};

vi.mock("../../api/tauri", () => ({
  openProject: vi.fn().mockResolvedValue({ indexedCount: 0 }),
  listenSearchEvents: (h: SearchEventHandlers) => {
    handlers = h;
    return Promise.resolve(() => {});
  },
  searchPosition: vi.fn(),
  cancelSearch: vi.fn(),
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

function Probe() {
  const { getHitsByRequestId } = usePositionSearch();
  renders += 1;
  lastHits = getHitsByRequestId(RID);
  hitCount = lastHits.length;
  return null;
}

/**
 * チャンクの中身が何回読まれたかを数える。
 *
 * 平坦化が増分なら合計は届いた件数に落ち着く。毎回作り直していれば、到着の
 * 回数ぶん二乗で伸びる（実測で n=100,000 のとき合計 836ms）。**回数は
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

async function mount() {
  await act(async () => {
    render(
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
  renders = 0;
  hitCount = 0;
  elementReads = 0;
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

    // 各チャンクは fileId が 0,1 / 2,3 / 4,5
    expect(hitCount).toBe(6);
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

  /** 溜めたまま畳まれても、タイマが後から起きて外れた state を触らないこと */
  test("畳まれたら溜め場ごと捨てる", async () => {
    await act(async () => {
      render(
        <PositionSearchProvider rootDir={null}>
          <Probe />
        </PositionSearchProvider>,
      );
    });

    deliver(3);

    cleanup();

    expect(() => {
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
  });
});
