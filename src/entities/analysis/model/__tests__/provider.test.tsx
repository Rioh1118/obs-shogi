// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

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

function mountAnalysis(initial: PositionSyncAdapter, { strict = false } = {}) {
  const seen: AnalysisContextType[] = [];

  function Probe() {
    const analysis = useAnalysis();
    useEffect(() => {
      seen.push(analysis);
    });
    return null;
  }

  const tree = (sync: PositionSyncAdapter) => {
    const provider = (
      <AnalysisProvider positionSync={sync}>
        <Probe />
      </AnalysisProvider>
    );
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };

  const utils = render(tree(initial));
  return {
    async setSync(sync: PositionSyncAdapter) {
      await act(async () => {
        utils.rerender(tree(sync));
      });
    },
    unmount() {
      act(() => {
        utils.unmount();
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

describe("AnalysisProvider のアンマウント", () => {
  it("同期の追いつきで張ったタイマーを、アンマウントで止める", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤だけ進める。再開待ちのタイマーが張られ、望む局面が P2 になる。
    await view.setSync(adapter("P2", "P1"));

    // 盤を戻し、同時にエンジンが P2 へ追いつく。局面を見る effect は
    // 「解析済みと同じ局面」で早期 return するので、この回は cleanup を登録しない。
    // 追いつきを見る effect は、そこへタイマーを張る。
    await view.setSync(adapter("P1", "P2"));

    startCore.mockClear();
    stopCore.mockClear();

    view.unmount();
    await advance(200);

    // 残っていると、畳まれた後にエンジンへ go を出し、window の無くなった
    // テスト環境ではタイマー自身が投げる。
    expect(startCore).not.toHaveBeenCalled();
    expect(stopCore).not.toHaveBeenCalled();
  });

  it("同じインスタンスに effect が張り直されても、自動再開は死なない", async () => {
    // StrictMode は setup → cleanup → setup を1つのインスタンスに走らせる。
    // 畳まれた印を cleanup で立てるだけだと、そこで立った印が残る。
    const view = mountAnalysis(adapter("P1", "P1"), { strict: true });

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    startCore.mockClear();

    // 盤とエンジンが揃って1手進む。自動再開が走るはず。
    await view.setSync(adapter("P2", "P2"));
    await advance(400);

    expect(startCore).toHaveBeenCalled();
    expect(view.current.state.isAnalyzing).toBe(true);
  });

  it("停止の応答を待っている間に畳まれたら、そのまま go を出さない", async () => {
    let releaseStop: () => void = () => {};
    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進める。再開は「前のセッションの停止待ち」で止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    view.unmount();
    startCore.mockClear();

    await act(async () => {
      releaseStop();
    });
    await advance(50);

    expect(startCore).not.toHaveBeenCalled();
  });

  it("再開の応答が畳まれた後に返っても、タイマーを張り直さない", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤とエンジンが揃って進む。再開が走り出し、エンジンの応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 待っている間にもう1手進む。応答が返った後に張り直す予約だけが積まれる。
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    view.unmount();

    startCore.mockClear();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    expect(startCore).not.toHaveBeenCalled();
    expect(stopCore).not.toHaveBeenCalled();
  });
});
