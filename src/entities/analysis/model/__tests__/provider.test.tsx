// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { AnalysisProvider } from "../provider";
import { useAnalysis } from "../useAnalysis";
import type { AnalysisContextType, PositionSyncAdapter } from "../types";

const startCore = vi.fn<() => Promise<string>>();
const stopCore = vi.fn<(sessionId?: string) => Promise<void>>();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@/entities/engine/api/tauri", () => ({
  startInfiniteAnalysis: () => startCore(),
  stopAnalysis: (sessionId?: string) => stopCore(sessionId),
}));
vi.mock("@/entities/engine", () => ({ useEngine: () => ({ isReady: true }) }));
vi.mock("@/entities/engine/api/events", () => ({
  setupAnalysisEventListeners: async () => () => {},
}));

/** 実時間を進める。打ち切りの判定が Date.now() を見るので偽タイマーは使えない。 */
const advance = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function mountAnalysis(initial: PositionSyncAdapter) {
  const seen: AnalysisContextType[] = [];

  function Probe() {
    const analysis = useAnalysis();
    useEffect(() => {
      seen.push(analysis);
    });
    return null;
  }

  const tree = (sync: PositionSyncAdapter) => (
    <AnalysisProvider positionSync={sync}>
      <Probe />
    </AnalysisProvider>
  );

  const utils = render(tree(initial));
  return {
    async setSync(sync: PositionSyncAdapter) {
      await act(async () => {
        utils.rerender(tree(sync));
      });
    },
    get current() {
      return seen[seen.length - 1];
    },
  };
}

const syncPosition = vi.fn<() => Promise<void>>();
const adapter = (currentSfen: string | null, syncedSfen: string | null): PositionSyncAdapter => ({
  currentSfen,
  syncedSfen,
  syncPosition,
});

beforeEach(() => {
  startCore.mockReset();
  stopCore.mockReset();
  syncPosition.mockReset();
  startCore.mockResolvedValue("session-1");
  stopCore.mockResolvedValue(undefined);
  syncPosition.mockResolvedValue(undefined);
});

describe("AnalysisProvider の同期待ちの打ち切り", () => {
  it("打ち切ったらエンジンのセッションも止める", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });
    expect(view.current.state.isAnalyzing).toBe(true);

    // 盤だけ進め、エンジンへの同期は追従させない
    await view.setSync(adapter("P2", "P1"));
    stopCore.mockClear();

    await advance(2400);

    expect(view.current.state.error).toBe("エンジンに現在の局面を送れませんでした");
    expect(view.current.state.isAnalyzing).toBe(false);

    // エラーを出すだけでは足りない。Rust 側のセッションを止めないと
    // 以降の start_infinite_analysis が「Analysis already running」で永久に弾かれる。
    expect(stopCore).toHaveBeenCalled();
  });

  it("前回の待ちの経過時間を次の待ちに持ち越さない", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 追従しないまま待たせ、打ち切りの手前で止める
    await view.setSync(adapter("P2", "P1"));
    await advance(1500);
    await act(async () => {
      await view.current.stopAnalysis();
    });

    // 打ち切りの上限を越える時間を空けてから、あらためて解析する
    await advance(2400);
    await view.setSync(adapter("P2", "P2"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });
    expect(view.current.state.isAnalyzing).toBe(true);

    // 1手進める。ここで待ちが始まるので、経過時間はゼロから数え直されなければならない。
    await view.setSync(adapter("P3", "P2"));
    await advance(300);

    expect(view.current.state.error).toBeNull();
    expect(view.current.state.isAnalyzing).toBe(true);
  });
});
