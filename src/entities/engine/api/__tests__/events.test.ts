import { beforeEach, describe, expect, test, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;

/** 購読の登録を差し替える。`failAt` 番目の登録を落とす */
const bus = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlistens: [] as ReturnType<typeof vi.fn>[],
  failAt: null as number | null,
  registered: 0,
}));

vi.mock(
  "@tauri-apps/api/event",
  async (actual) =>
    ({
      ...(await actual<typeof import("@tauri-apps/api/event")>()),
      listen: (async (name: string, handler: Handler) => {
        const index = bus.registered++;
        if (bus.failAt === index) throw new Error("listen failed");
        bus.handlers.set(name, handler);
        const unlisten = vi.fn();
        bus.unlistens.push(unlisten);
        return unlisten;
      }) as unknown as typeof import("@tauri-apps/api/event").listen,
    }) satisfies typeof import("@tauri-apps/api/event"),
);

const { setupEngineEventListeners } = await import("../events");

beforeEach(() => {
  bus.handlers.clear();
  bus.unlistens.length = 0;
  bus.failAt = null;
  bus.registered = 0;
});

function fire(name: string, payload: unknown) {
  bus.handlers.get(name)?.({ payload });
}

describe("プロセスの通知", () => {
  const listeners = () => ({
    onExited: vi.fn(),
    onUnresponsive: vi.fn(),
    onAnswered: vi.fn(),
  });

  test("要求の番号と最後の出力を購読先へ渡す", async () => {
    const on = listeners();
    await setupEngineEventListeners(on);

    fire("engine-exited", { request: 7, lastOutput: "bye" });
    expect(on.onExited).toHaveBeenCalledExactlyOnceWith(7, "bye");

    fire("engine-unresponsive", { request: 8, reason: "unwritable", lastOutput: null });
    expect(on.onUnresponsive).toHaveBeenCalledExactlyOnceWith(8, "unwritable", null);

    fire("engine-answered", { request: 9 });
    expect(on.onAnswered).toHaveBeenCalledExactlyOnceWith(9);
  });

  /** 登録が残ると、畳まれた画面のハンドラが呼ばれ続ける */
  test("途中の登録が落ちたら、登録済みの分を解除して投げ直す", async () => {
    bus.failAt = 2;

    await expect(setupEngineEventListeners(listeners())).rejects.toThrow("listen failed");

    expect(bus.unlistens).toHaveLength(2);
    for (const unlisten of bus.unlistens) expect(unlisten).toHaveBeenCalledTimes(1);
  });

  test("解除は1本が投げても残りへ進み、2度目の呼び出しでは何も解除しない", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const stop = await setupEngineEventListeners(listeners());
    bus.unlistens[0].mockImplementation(() => {
      throw new Error("unlisten failed");
    });

    stop();
    stop();

    for (const unlisten of bus.unlistens) expect(unlisten).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });
});
