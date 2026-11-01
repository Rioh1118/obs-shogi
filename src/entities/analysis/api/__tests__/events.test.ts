import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AnalysisResult } from "@/entities/engine";
import type { AnalysisSessionId } from "../tauri";

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

const { setupAnalysisEventListeners } = await import("../events");

const SESSION = "session-1" as AnalysisSessionId;
const RESULT: AnalysisResult = { candidates: [] };

beforeEach(() => {
  bus.handlers.clear();
  bus.unlistens.length = 0;
  bus.failAt = null;
  bus.registered = 0;
});

function fire(name: string, payload: unknown) {
  bus.handlers.get(name)?.({ payload });
}

describe("解析の通知", () => {
  test("途中経過と完了を、席の識別子を付けて別々の購読先へ渡す", async () => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    await setupAnalysisEventListeners({ onUpdate, onComplete });

    fire("analysis-update", { sessionId: SESSION, result: RESULT });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(SESSION, RESULT);
    expect(onComplete).not.toHaveBeenCalled();

    fire("analysis-complete", { sessionId: SESSION, result: RESULT });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(SESSION, RESULT);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
