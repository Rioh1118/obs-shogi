// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SearchEventHandlers } from "@/entities/search/api/tauri";
import type { PositionSearchContextType } from "../types";

const { openProjectApi, searchPositionApi, cancelSearchApi } = vi.hoisted(() => ({
  openProjectApi: vi.fn(),
  searchPositionApi: vi.fn(),
  cancelSearchApi: vi.fn(),
}));

let handlers!: SearchEventHandlers;

vi.mock(
  "@/entities/search/api/tauri",
  () =>
    ({
      openProject: openProjectApi,
      searchPosition: searchPositionApi,
      cancelSearch: cancelSearchApi,
      listenSearchEvents: (h: SearchEventHandlers) => {
        handlers = h;
        return Promise.resolve(() => {});
      },
    }) satisfies typeof import("@/entities/search/api/tauri"),
);

const { PositionSearchProvider } = await import("../provider");
const { usePositionSearch } = await import("../usePositionSearch");

let search!: PositionSearchContextType;

function Probe() {
  search = usePositionSearch();
  return null;
}

const app = (rootDir: string | null) => (
  <PositionSearchProvider rootDir={rootDir}>
    <Probe />
  </PositionSearchProvider>
);

const INPUT = { sfen: "s", consistency: "BestEffort", chunkSize: 300 } as const;

const hit = {
  occ: { fileId: 1, gen: 1, nodeId: 1 },
  cursor: { tesuu: 0, forkPointers: [] },
};

beforeEach(() => {
  openProjectApi.mockReset().mockResolvedValue({ totalFiles: 0 });
  searchPositionApi.mockReset().mockResolvedValue({ requestId: 7 });
  cancelSearchApi.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("番号が無いときの読み出し", () => {
  test("空の値を返す", async () => {
    await act(async () => {
      render(app(null));
    });

    expect(search.getSessionByRequestId(null)).toBeNull();
    expect(search.getSessionByRequestId(7)).toBeNull();
    expect(search.getHitsByRequestId(null)).toEqual([]);
    expect(search.getHitsByRequestId(7)).toEqual([]);
    expect(search.isSearchingRequest(null)).toBe(false);
    expect(search.isSearchingRequest(7)).toBe(false);
  });
});

describe("検索を起こす", () => {
  test("番号が返ったら受け付けた結末を返し、セッションが検索中になる", async () => {
    await act(async () => {
      render(app(null));
    });

    let launch: unknown;
    await act(async () => {
      launch = await search.searchPosition(INPUT);
    });

    expect(launch).toEqual({ status: "started", requestId: 7 });
    expect(search.isSearchingRequest(7)).toBe(true);
    expect(search.getSessionByRequestId(7)).toMatchObject({ requestId: 7, isDone: false });
  });

  test("起動の失敗はそのまま投げる", async () => {
    searchPositionApi.mockRejectedValue(new Error("準備中"));
    await act(async () => {
      render(app(null));
    });

    await expect(search.searchPosition(INPUT)).rejects.toThrow("準備中");
  });

  /** 待っている間に開き直された検索を Rust に走らせ続けない */
  test("番号が返る前に開き直されたら、取り下げて superseded を返す", async () => {
    let resolveSearch!: (out: { requestId: number }) => void;
    searchPositionApi.mockReturnValue(new Promise((r) => (resolveSearch = r)));
    cancelSearchApi.mockRejectedValue(new Error("届かない"));

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/old"));
    });

    const pending = search.searchPosition(INPUT);
    await act(async () => {
      view.rerender(app("/new"));
    });
    resolveSearch({ requestId: 7 });

    await expect(pending).resolves.toEqual({ status: "superseded" });
    expect(cancelSearchApi).toHaveBeenCalledWith(7);
    expect(search.getSessionByRequestId(7)).toBeNull();
  });

  /** 数えずに名指しで捨てると、次に開き直したとき名指しを忘れて通ってしまう */
  test("番号が返る前に取り下げた検索は、さらに開き直しても通らない", async () => {
    let resolveSearch!: (out: { requestId: number }) => void;
    searchPositionApi.mockReturnValue(new Promise((r) => (resolveSearch = r)));

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/first"));
    });

    const pending = search.searchPosition(INPUT);
    await act(async () => {
      view.rerender(app("/second"));
    });
    resolveSearch({ requestId: 7 });
    await pending;

    await act(async () => {
      view.rerender(app("/third"));
    });
    expect(openProjectApi.mock.calls).toEqual([["/first"], ["/second"], ["/third"]]);

    act(() => {
      handlers.onSearchBegin({ requestId: 7, stale: false });
    });

    expect(search.getSessionByRequestId(7)).toBeNull();
  });

  test("取り下げの失敗は投げない", async () => {
    cancelSearchApi.mockRejectedValue(new Error("届かない"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      render(app(null));
    });

    await expect(search.cancelSearch(7)).resolves.toBeUndefined();

    expect(cancelSearchApi).toHaveBeenCalledWith(7);
    consoleError.mockRestore();
  });
});

describe("ヒットのパス", () => {
  test("届いたパスの表から引く", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(app(null));
    });

    act(() => {
      handlers.onSearchChunk({
        requestId: 7,
        chunk: [hit],
        files: [{ fileId: 1, absPath: "/ws/a.kif" }],
      });
      vi.runAllTimers();
    });
    vi.useRealTimers();

    expect(search.resolveHitAbsPath(hit)).toBe("/ws/a.kif");
    const other = { ...hit, occ: { ...hit.occ, fileId: 2 } };
    expect(search.resolveHitAbsPath(other)).toBeNull();
  });
});

describe("索引を開く失敗", () => {
  test("Error の文を openError へ載せる", async () => {
    openProjectApi.mockRejectedValue(new Error("読めません"));

    await act(async () => {
      render(app("/ws"));
    });

    expect(search.state.openError).toBe("読めません");
  });

  /** Rust の `Err` は文字列のまま届く */
  test("文字列の失敗もそのまま載せる", async () => {
    openProjectApi.mockRejectedValue("読めません");

    await act(async () => {
      render(app("/ws"));
    });

    expect(search.state.openError).toBe("読めません");
  });

  test("開き直すと前の失敗を消す", async () => {
    openProjectApi.mockRejectedValueOnce(new Error("読めません"));

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/ws"));
    });
    await act(async () => {
      view.rerender(app("/next"));
    });

    expect(search.state.openError).toBeNull();
  });

  // TODO(#430): 飛行中の open を根を見ずに1本へ畳むので、新しい根が開かれない
  test("開いている間に根が変わっても、呼び出しは1本のまま", async () => {
    openProjectApi.mockReturnValue(new Promise(() => {}));

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/ws"));
    });
    await act(async () => {
      view.rerender(app("/next"));
    });

    expect(openProjectApi.mock.calls).toEqual([["/ws"]]);
  });
});
