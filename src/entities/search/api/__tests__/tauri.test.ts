import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVT_INDEX_PROGRESS,
  EVT_INDEX_STATE,
  EVT_INDEX_WARN,
  EVT_SEARCH_BEGIN,
  EVT_SEARCH_CHUNK,
  EVT_SEARCH_END,
  EVT_SEARCH_ERROR,
} from "../events";
import { cancelSearch, listenSearchEvents, openProject, searchPosition } from "../tauri";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock(
  "@tauri-apps/api/core",
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
      invoke,
    }) satisfies typeof import("@tauri-apps/api/core"),
);
vi.mock(
  "@tauri-apps/api/event",
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
      listen,
    }) satisfies typeof import("@tauri-apps/api/event"),
);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({});
  listen.mockReset();
});

describe("コマンド", () => {
  /** Rust の引数は全部 `input` 1つで受ける。平らに渡すと `invoke` が断る */
  it("引数を input に包んで渡す", async () => {
    await openProject("/ws");
    await searchPosition({ sfen: "s", consistency: "BestEffort", chunkSize: 300 });
    await cancelSearch(7);

    expect(invoke.mock.calls).toEqual([
      ["open_project", { input: { rootDir: "/ws" } }],
      ["search_position", { input: { sfen: "s", consistency: "BestEffort", chunkSize: 300 } }],
      ["cancel_search", { input: { requestId: 7 } }],
    ]);
  });
});

describe("listenSearchEvents", () => {
  const handlers = {
    onIndexState: vi.fn(),
    onIndexProgress: vi.fn(),
    onIndexWarn: vi.fn(),
    onSearchBegin: vi.fn(),
    onSearchChunk: vi.fn(),
    onSearchEnd: vi.fn(),
    onSearchError: vi.fn(),
  };

  /** 綴りごとに、Rust が emit したときに呼ばれる関数を覚える */
  function captureListeners() {
    const delivered = new Map<string, (event: { payload: unknown }) => void>();
    const unlisten = vi.fn();
    listen.mockImplementation((name: string, callback: (e: { payload: unknown }) => void) => {
      delivered.set(name, callback);
      return Promise.resolve(unlisten);
    });
    return { delivered, unlisten };
  }

  it.each([
    [EVT_INDEX_STATE, "onIndexState"],
    [EVT_INDEX_PROGRESS, "onIndexProgress"],
    [EVT_INDEX_WARN, "onIndexWarn"],
    [EVT_SEARCH_BEGIN, "onSearchBegin"],
    [EVT_SEARCH_CHUNK, "onSearchChunk"],
    [EVT_SEARCH_END, "onSearchEnd"],
    [EVT_SEARCH_ERROR, "onSearchError"],
  ] as const)("%s の中身を %s へ渡す", async (name, handler) => {
    const { delivered } = captureListeners();
    Object.values(handlers).forEach((h) => h.mockClear());

    await listenSearchEvents(handlers);
    delivered.get(name)?.({ payload: { from: name } });

    const called = Object.entries(handlers).filter(([, h]) => h.mock.calls.length > 0);
    expect(called.map(([key]) => key)).toEqual([handler]);
    expect(handlers[handler]).toHaveBeenCalledWith({ from: name });
  });

  it("返した関数で7本とも解除する", async () => {
    const { unlisten } = captureListeners();

    const unlistenAll = await listenSearchEvents(handlers);
    expect(unlisten).not.toHaveBeenCalled();

    unlistenAll();
    expect(unlisten).toHaveBeenCalledTimes(7);
  });
});
