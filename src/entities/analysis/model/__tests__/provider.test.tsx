// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import { AnalysisProvider } from "../provider";
import { useAnalysis } from "../useAnalysis";
import type { AnalysisContextType, PositionSyncAdapter } from "../types";

const startCore = vi.fn<() => Promise<string>>();
const stopCore = vi.fn<(sessionId?: string) => Promise<void>>();

// リスナを実際に登録させたい回だけ true にする。既定を true にすると、
// 全部の回で登録と解除が挟まって、見たい経路が長くなる。
let tauri = false;
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri }));
vi.mock("@/entities/engine/api/tauri", () => ({
  startInfiniteAnalysis: () => startCore(),
  stopAnalysis: (sessionId?: string) => stopCore(sessionId),
}));
vi.mock("@/entities/engine", () => ({ useEngine: () => ({ isReady: true }) }));

/** 最後に登録されたリスナ。Rust からの通知を差し込む口。 */
let listeners: { onError: (error: string) => void } | null = null;
vi.mock("@/entities/engine/api/events", () => ({
  setupAnalysisEventListeners: async (handlers: { onError: (error: string) => void }) => {
    listeners = handlers;
    return () => {};
  },
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
  tauri = false;
  listeners = null;
  startCore.mockReset();
  stopCore.mockReset();
  syncPosition.mockReset();
  startCore.mockResolvedValue("session-1");
  stopCore.mockResolvedValue(undefined);
  syncPosition.mockResolvedValue(undefined);
});

// **畳まないまま次のテストへ渡さない。** 自動 cleanup は入っていない
// （`vite.config.ts` の test に setup ファイルが無い）ので、`unmount()` を
// 呼ばずに終わったテストの画面は生きたまま残る。残ると同期待ちの打ち切りが
// 2秒後に停止を撃ち、**それが後のテストの中に落ちる**——「畳んだ後は撃たない」
// を見ている検査が、他のテストの置き土産で赤くなる。
afterEach(cleanup);

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
  it("解析中に畳まれたら、エンジンのセッションを返す", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });
    expect(view.current.state.isAnalyzing).toBe(true);

    stopCore.mockClear();
    view.unmount();

    // 返さないと Rust の台帳に席が残り、以降どの解析も
    // 「Analysis already running」で断られる。エンジンを畳み直すまで戻れない。
    expect(stopCore).toHaveBeenCalledTimes(1);

    // **セッションを指さない。** 指すと、席に居るのが別のセッションだったとき
    // Rust が照合して断る（`bridge.rs` の `stop_session`）。
    expect(stopCore).toHaveBeenCalledWith(undefined);
  });

  it("エラーで止まって見えていても、畳まれたら席を返す", async () => {
    tauri = true;
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // Rust からのエラー通知。`isAnalyzing` は落ちるが `sessionId` は残り、
    // 席も Rust に在りうる（`reducer.ts` の `set_error`）。
    await act(async () => {
      listeners?.onError("engine died");
    });
    expect(view.current.state.isAnalyzing).toBe(false);

    stopCore.mockClear();
    view.unmount();

    expect(stopCore).toHaveBeenCalledTimes(1);
  });

  it("解析していないまま畳まれたら、停止を撃たない", async () => {
    // StrictMode は mount 直後に setup → cleanup → setup を走らせる。
    // ここで撃つと、席を持っていないのに停止が飛ぶ。
    const view = mountAnalysis(adapter("P1", "P1"), { strict: true });
    expect(stopCore).not.toHaveBeenCalled();

    view.unmount();
    expect(stopCore).not.toHaveBeenCalled();
  });

  it("開始の応答が畳まれた後に返ってきたら、その席を返す", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));

    // 応答待ちのまま置く。await しない（返ってこないので）。
    void view.current.startInfiniteAnalysis();
    await advance(50);

    // 畳んだ時点では席の ID を誰も知らない。後始末は空振りする。
    view.unmount();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-late");
    });
    await advance(50);

    // 返さないと、誰も見ていない解析が Rust の席に居座り続ける。
    expect(stopCore).toHaveBeenCalledWith("session-late");
  });

  it("再開の開始が畳まれた後に返ってきたら、その席を返す", async () => {
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

    // 盤とエンジンが揃って進む。再開が走り、開始の応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    view.unmount();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    // 畳んだときの後始末が止めたのは古い方（既に停止済み）。
    // 新しい席はここで返すしかない。
    expect(stopCore).toHaveBeenCalledWith("session-2");
  });

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

    view.unmount();

    // 畳んだ時点の後始末（席を返す停止）は数に入れない。ここで見たいのは
    // 「タイマーが後から動かないこと」だけ。
    stopCore.mockClear();
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
    // **待たせている停止を1本ずつ持つ。** 変数1つに上書きしていくと、
    // 畳んだときの後始末で撃たれる停止が同じ変数を奪い、下で解いているのが
    // 「再開が待っている停止」でなくなる——再開は止まったままなので
    // テストは通り続けるが、見たかった経路は踏まなくなる。
    const pendingStops: Array<() => void> = [];
    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingStops.push(resolve);
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進める。再開は「前のセッションの停止待ち」で止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 再開はここで止まっている
    expect(pendingStops).toHaveLength(1);

    view.unmount();
    startCore.mockClear();

    await act(async () => {
      pendingStops[0]();
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

    // 撃たれる停止は、返ってきた席を返す1本だけ。**次の再開の前置きではない。**
    // 前置きなら、その後に go が続く。
    expect(stopCore).toHaveBeenCalledTimes(1);
    expect(stopCore).toHaveBeenCalledWith("session-2");
  });
});
