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

function Probe() {
  const { getHitsByRequestId } = usePositionSearch();
  renders += 1;
  hitCount = getHitsByRequestId(RID).length;
  return null;
}

function chunkOf(n: number, from: number): SearchChunkPayload {
  const chunk = Array.from({ length: n }, (_, i) => hitAt(from + i));
  return {
    requestId: RID,
    chunk,
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
