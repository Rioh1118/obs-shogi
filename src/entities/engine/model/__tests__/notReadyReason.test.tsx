// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { EngineProvider } from "../provider";
import { useEngine } from "../useEngine";
import type { EngineContextType, EngineRuntimeConfig } from "../types";
import type { EngineInfo } from "@/entities/engine/api/rust-types";

const initialize = vi.fn<(runtime: EngineRuntimeConfig) => Promise<EngineInfo>>();
const shutdown = vi.fn<() => Promise<void>>();
vi.mock("@/entities/engine/api/initializer", () => ({
  engineInitializer: {
    initialize: (runtime: EngineRuntimeConfig) => initialize(runtime),
    shutdown: () => shutdown(),
  },
}));

const runtime = (enginePath: string): EngineRuntimeConfig =>
  ({ enginePath, workDir: "/w", evalDir: "/e", options: {} }) as EngineRuntimeConfig;

const info = { name: "YaneuraOu", author: "yaneurao" } as EngineInfo;

beforeEach(() => {
  initialize.mockReset();
  shutdown.mockReset();
  shutdown.mockResolvedValue(undefined);
});
afterEach(cleanup);

const advance = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function mountEngine(desired: EngineRuntimeConfig | null) {
  const seen: EngineContextType[] = [];

  function Probe() {
    const engine = useEngine();
    useEffect(() => {
      seen.push(engine);
    });
    return null;
  }

  const tree = (d: EngineRuntimeConfig | null) => (
    <EngineProvider desiredRuntime={d}>
      <Probe />
    </EngineProvider>
  );

  const utils = render(tree(desired));
  return {
    async setDesired(d: EngineRuntimeConfig | null) {
      await act(async () => {
        utils.rerender(tree(d));
      });
    },
    /** `isReady` が false だった描画の理由を、出た順に全部。 */
    reasonsSeen() {
      return seen.filter((e) => !e.isReady).map((e) => e.notReadyReason);
    },
    get current() {
      return seen[seen.length - 1];
    },
  };
}

/**
 * `isReady` が false の間、解析側はこの理由だけを見て断りを選ぶ（`NOT_READY_REFUSALS`）。
 *
 * **`AnalysisProvider` のテストは `useEngine` をモックする**ので、この導出はそちらでは
 * 1度も走らない。断りを取り違える窓はここでしか捕まえられない。
 */
describe("エンジンが使えない理由", () => {
  it("起こし直しの間、一度も「選んでください」に落ちない", async () => {
    initialize.mockResolvedValue(info);

    const view = mountEngine(runtime("/a"));
    await advance(20);
    expect(view.current.isReady).toBe(true);

    // 設定でオプションを変えて保存した回。`restart()` は
    // `shutdown()`（→ phase: "idle"）を await してから `initialize()` を撃つ。
    await view.setDesired(runtime("/b"));
    await advance(30);

    // **`idle` の窓も「起動を待っている」。** ここで `"no-engine"` に落ちると、
    // 起こし直しを案内された利用者が、その指示に従った直後に同じ指示を受ける。
    expect(view.reasonsSeen()).not.toContain("no-engine");
    expect(view.current.isReady).toBe(true);
  });

  it("エンジンを選んでいなければ「選んでください」の理由になる", async () => {
    const view = mountEngine(null);
    await advance(20);

    expect(view.current.isReady).toBe(false);
    expect(view.current.notReadyReason).toBe("no-engine");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("壊れたプリセットの選択を外したら、その瞬間から「選んでください」になる", async () => {
    initialize.mockRejectedValue(new Error("boom"));
    // 畳むのは本物の IPC 往復。その間も理由を配り続ける。
    let finishShutdown: () => void = () => {};
    shutdown.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve;
        }),
    );

    const view = mountEngine(runtime("/broken"));
    await advance(30);
    expect(view.current.notReadyReason).toBe("failed");

    // この状況でいちばん自然な復帰操作——壊れたプリセットの選択を外す。
    await view.setDesired(null);
    await advance(20);

    // **もう選んでいないプリセットのオプションを変えろ、と案内しない。**
    expect(view.current.notReadyReason).toBe("no-engine");

    await act(async () => {
      finishShutdown();
    });
    await advance(20);
    expect(view.current.notReadyReason).toBe("no-engine");
  });

  it("初期化が落ちたら failed", async () => {
    initialize.mockRejectedValue(new Error("boom"));

    const view = mountEngine(runtime("/a"));
    await advance(30);

    expect(view.current.isReady).toBe(false);
    expect(view.current.notReadyReason).toBe("failed");
  });
});
