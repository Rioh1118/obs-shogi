// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnalysisCandidate, EngineRuntimeConfig } from "@/entities/engine";
import type { MateSearchContextType } from "../types";

/**
 * 詰み探索の寿命（`docs/state-transitions/mate-search.md` の M0〜M3）。
 *
 * Rust との往復はどれも非同期で、終わりの通知は開始の応答より先に着きうる。閉じた後に着いた応答と通知が
 * 画面を動かさないこと、検討の中断を待ってから始めることを見る
 */
type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
type Call = {
  cmd: string;
  args: Record<string, unknown> | undefined;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};
let calls: Call[] = [];

vi.mock("@tauri-apps/api/core", async (importActual) => {
  const actual = await importActual<typeof import("@tauri-apps/api/core")>();
  const mocked = {
    ...actual,
    isTauri: () => true,
    invoke: (<T,>(cmd: string, args?: Record<string, unknown>) =>
      new Promise<T>((resolve, reject) =>
        calls.push({ cmd, args, resolve: resolve as Call["resolve"], reject }),
      )) as typeof actual.invoke,
  };
  return mocked satisfies typeof import("@tauri-apps/api/core");
});
vi.mock("@tauri-apps/api/event", async (importActual) => {
  const actual = await importActual<typeof import("@tauri-apps/api/event")>();
  const mocked = {
    ...actual,
    listen: (async (name: string, handler: Handler) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }) as unknown as typeof actual.listen,
  };
  return mocked satisfies typeof import("@tauri-apps/api/event");
});

const { MateSearchProvider } = await import("../provider");
const { useMateSearch } = await import("../useMateSearch");

const ENGINE: EngineRuntimeConfig = {
  enginePath: "/e/mate",
  evalPath: null,
  book: null,
  values: { USI_Hash: "256" },
};
const CANDIDATES: AnalysisCandidate[] = [{ rank: 1, first_move: "7g7f", pv_line: ["7g7f"] }];
const RESULT = { candidates: CANDIDATES };

const props = {
  currentSfen: "P1" as string | null,
  engine: ENGINE as EngineRuntimeConfig | null,
  limitMs: 30_000 as number | null,
  analysisBusy: false,
  stopAnalysis: vi.fn(async () => {}),
};
let seen!: MateSearchContextType;
function Probe() {
  seen = useMateSearch();
  return null;
}
const tree = () => (
  <MateSearchProvider {...props}>
    <Probe />
  </MateSearchProvider>
);
let view: ReturnType<typeof render>;

const flush = () => act(async () => {});
const named = (cmd: string) => calls.filter((c) => c.cmd === cmd);
const last = (cmd: string) => named(cmd).slice(-1)[0]!;
const emit = (name: string, payload: unknown) => act(async () => handlers.get(name)?.({ payload }));
const finished = (sessionId: string, conclusion: unknown) =>
  emit("mate-search-finished", { sessionId, result: RESULT, conclusion });
const toggle = () =>
  act(async () => {
    void seen.toggle();
  });
const settle = (call: Call, value: unknown) => act(async () => call.resolve(value));
const refuse = (call: Call, value: unknown) => act(async () => call.reject(value));
const rerender = async (patch: Partial<typeof props>) => {
  Object.assign(props, patch);
  view.rerender(tree());
  await flush();
};

/** 探索中（M2）まで進める */
async function searching(session = "s1") {
  await toggle();
  await settle(last("start_mate_search"), session);
}

beforeEach(async () => {
  calls = [];
  handlers.clear();
  Object.assign(props, {
    currentSfen: "P1",
    engine: ENGINE,
    limitMs: 30_000,
    analysisBusy: false,
    stopAnalysis: vi.fn(async () => {}),
  });
  view = render(tree());
  await flush();
  // 前の画面の探索の後始末
  await settle(last("stop_mate_search"), null);
  calls = [];
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("始める", () => {
  test("現局面と上限とプリセットを送り、起動中 → 探索中と進む", async () => {
    await toggle();
    expect(last("start_mate_search").args).toEqual({
      enginePath: "/e/mate",
      values: [{ name: "USI_Hash", value: "256" }],
      evalPath: null,
      book: null,
      position: "P1",
      limitMs: 30_000,
    });
    expect(seen.state.phase).toBe("starting");
    expect(seen.ownsTable).toBe(true);

    await settle(last("start_mate_search"), "s1");
    expect(seen.state.phase).toBe("searching");
  });

  test("検討中なら、中断し終えてから始める。待つ間の表は検討のもの", async () => {
    let stopped!: () => void;
    await rerender({
      analysisBusy: true,
      stopAnalysis: vi.fn(() => new Promise<void>((r) => (stopped = r))),
    });
    await toggle();
    expect(props.stopAnalysis).toHaveBeenCalledTimes(1);
    expect(seen.ownsTable).toBe(false);
    expect(named("start_mate_search")).toHaveLength(0);

    await act(async () => stopped());
    expect(named("start_mate_search")).toHaveLength(1);
    expect(seen.ownsTable).toBe(true);
  });

  test("検討の中断が届かなければ始めない（V6 は検討の語が言う）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await rerender({
      analysisBusy: true,
      stopAnalysis: vi.fn(async () => Promise.reject(new Error("unreachable"))),
    });
    await toggle();
    expect(named("start_mate_search")).toHaveLength(0);
    expect(seen.state.phase).toBe("closed");
  });

  test("検討が中断に答えない断りでは、表を検討に返す", async () => {
    await toggle();
    await refuse(last("start_mate_search"), { kind: "analysisUnresponsive" });
    expect(seen.state.phase).toBe("closed");
  });

  test("起動の失敗と、ほかの断りは、別の結論で終わる", async () => {
    await toggle();
    await refuse(last("start_mate_search"), { kind: "engineFailed", failure: {} });
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "startFailed" } });

    await toggle();
    await refuse(last("start_mate_search"), "ipc closed");
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "refused" } });
  });

  test("動いているエンジンで始め直すときは、起動中と言わない。落ちた後は言う", async () => {
    await searching();
    await finished("s1", { kind: "noMate" });
    await toggle();
    expect(seen.state.phase).toBe("searching");
    await settle(last("start_mate_search"), "s2");

    await finished("s2", { kind: "engineExited" });
    await toggle();
    expect(seen.state.phase).toBe("starting");
  });

  test("プリセットの指定か局面が無ければ何もしない", async () => {
    await rerender({ engine: null });
    expect(seen.available).toBe(false);
    await toggle();
    await rerender({ engine: ENGINE, currentSfen: null });
    await toggle();
    expect(calls).toHaveLength(0);
  });
});

describe("受ける", () => {
  test("途中経過を間引いて候補手にし、終わりで結論と最後の候補手を残す", async () => {
    vi.useFakeTimers();
    await searching();
    await emit("mate-search-update", { sessionId: "s1", result: RESULT });
    expect(seen.state).toMatchObject({ candidates: [] });
    await act(async () => vi.advanceTimersByTime(100));
    expect(seen.state).toMatchObject({ phase: "searching", candidates: CANDIDATES });

    await act(async () => vi.advanceTimersByTime(7_000));
    await finished("s1", { kind: "mate", moves: ["7g7f"] });
    expect(seen.state).toMatchObject({
      phase: "finished",
      outcome: { kind: "mate", moves: ["7g7f"] },
      candidates: CANDIDATES,
      elapsedMs: 7_100,
    });
  });

  test("終わりの通知が開始の応答より先に着いても、取りこぼさない", async () => {
    await toggle();
    await finished("s1", { kind: "noMate" });
    expect(seen.state.phase).toBe("starting");
    await settle(last("start_mate_search"), "s1");
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "noMate" } });
  });

  test("ほかの探索の通知では動かない", async () => {
    vi.useFakeTimers();
    await searching();
    await emit("mate-search-update", { sessionId: "old", result: RESULT });
    await finished("old", { kind: "cancelled" });
    await act(async () => vi.advanceTimersByTime(200));
    expect(seen.state).toMatchObject({ phase: "searching", candidates: [] });
  });

  test("終わった後に、間引いていた途中経過は出さない", async () => {
    vi.useFakeTimers();
    await searching();
    await emit("mate-search-update", { sessionId: "s1", result: { candidates: [] } });
    await finished("s1", { kind: "timeout" });
    await act(async () => vi.advanceTimersByTime(200));
    expect(seen.state).toMatchObject({ phase: "finished", candidates: CANDIDATES });
  });
});

describe("中止", () => {
  test("探索中に押すと止め、終わりの通知で中止の結論になる。止まるまで押し直しても送らない", async () => {
    await searching();
    await toggle();
    expect(seen.state).toMatchObject({ phase: "searching", stopping: true });
    await toggle();
    expect(named("stop_mate_search")).toHaveLength(1);

    await finished("s1", { kind: "cancelled" });
    await settle(last("stop_mate_search"), null);
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "cancelled" } });
  });

  test("起動中に押すと、始められなかったことを中止と読む", async () => {
    await toggle();
    const start = last("start_mate_search");
    await toggle();
    expect(named("stop_mate_search")).toHaveLength(1);
    await refuse(start, { kind: "superseded" });
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "cancelled" } });
  });

  test("自分で中止していない superseded は、表を検討に返す", async () => {
    await toggle();
    await refuse(last("start_mate_search"), { kind: "superseded" });
    expect(seen.state.phase).toBe("closed");
  });

  test("検討の中断を待っている間に押すと、始めない", async () => {
    let stopped!: () => void;
    await rerender({
      analysisBusy: true,
      stopAnalysis: vi.fn(() => new Promise<void>((r) => (stopped = r))),
    });
    await toggle();
    await toggle();
    await act(async () => stopped());
    expect(named("start_mate_search")).toHaveLength(0);
    expect(seen.state.phase).toBe("closed");
  });

  test("中止が届かなければ、もう一度押せる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await searching();
    await toggle();
    await refuse(last("stop_mate_search"), "ipc closed");
    expect(seen.state).toMatchObject({ phase: "searching", stopping: false });
  });
});

describe("閉じる", () => {
  test.each(["starting", "searching", "finished"] as const)(
    "%s で局面が動けば、表を検討に返す",
    async (phase) => {
      await toggle();
      const start = last("start_mate_search");
      if (phase !== "starting") await settle(start, "s1");
      if (phase === "finished") await finished("s1", { kind: "noMate" });

      await rerender({ currentSfen: "P2" });

      expect(seen.state.phase).toBe("closed");
      expect(named("stop_mate_search")).toHaveLength(phase === "finished" ? 0 : 1);
    },
  );

  test("検討の中断を待っている間に局面が動けば、始めない", async () => {
    let stopped!: () => void;
    await rerender({
      analysisBusy: true,
      stopAnalysis: vi.fn(() => new Promise<void>((r) => (stopped = r))),
    });
    await toggle();
    await rerender({ currentSfen: "P2" });
    await act(async () => stopped());
    expect(named("start_mate_search")).toHaveLength(0);
    expect(seen.state.phase).toBe("closed");
  });

  test("棋譜を閉じても中止する", async () => {
    await searching();
    await rerender({ currentSfen: null });
    expect(seen.state.phase).toBe("closed");
    expect(named("stop_mate_search")).toHaveLength(1);
  });

  test("閉じた後に着いた応答と終わりは、表を取り返さない", async () => {
    await toggle();
    const start = last("start_mate_search");
    await act(async () => seen.dismiss());
    await settle(start, "s1");
    await finished("s1", { kind: "cancelled" });
    expect(seen.state.phase).toBe("closed");
  });

  test("閉じて始め直した後に着いた前の応答は、新しい探索の番号にならない", async () => {
    await toggle();
    const old = last("start_mate_search");
    await act(async () => seen.dismiss());
    await settle(last("stop_mate_search"), null);
    await toggle();
    await settle(old, "old");
    expect(seen.state.phase).toBe("starting");

    await settle(last("start_mate_search"), "new");
    await finished("old", { kind: "cancelled" });
    expect(seen.state).toMatchObject({ phase: "searching", sessionId: "new" });
  });

  test("閉じた直後に始め直すと、前の中止が返ってから送る", async () => {
    await searching();
    await act(async () => seen.dismiss());
    await toggle();
    expect(named("start_mate_search")).toHaveLength(1);

    await settle(last("stop_mate_search"), null);
    expect(named("start_mate_search")).toHaveLength(2);
  });

  test("前の中止を待つ間に中止すれば、始めない", async () => {
    await searching();
    await act(async () => seen.dismiss());
    const pendingStop = last("stop_mate_search");
    await toggle();
    await toggle();
    await settle(pendingStop, null);
    expect(named("start_mate_search")).toHaveLength(1);
    expect(seen.state).toMatchObject({ phase: "finished", outcome: { kind: "cancelled" } });
  });

  test("unmount で止める", async () => {
    await searching();
    view.unmount();
    expect(named("stop_mate_search")).toHaveLength(1);
  });
});
