// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { EngineProvider } from "../provider";
import { useEngine } from "../useEngine";
import type { EngineNotReadyReason, EngineRuntimeConfig } from "../types";
import type { EngineInfo } from "@/entities/engine/api/rust-types";

/**
 * **見るのは `notReadyReason` の並びだけ。**
 *
 * この理由は解析側が「解析を打ち切るか、待つか」を決めるのに使う
 * （`docs/state-transitions/analysis.md` の ※5）ので、**どの窓でどれが立つか**が
 * 振る舞いそのもの。`phase` を見ても、待てば戻る窓と戻らない窓は区別できない。
 */
const initialize = vi.fn<(runtime: EngineRuntimeConfig) => Promise<EngineInfo>>();
const shutdown = vi.fn<() => Promise<void>>();
vi.mock("../../api/initializer", () => ({
  engineInitializer: {
    initialize: (runtime: EngineRuntimeConfig) => initialize(runtime),
    shutdown: () => shutdown(),
  },
}));

const info = { name: "test-engine", author: "t" } as unknown as EngineInfo;

const runtime = (options: Record<string, string> = {}): EngineRuntimeConfig => ({
  enginePath: "/e",
  workDir: "/w",
  evalDir: "/v",
  bookDir: null,
  bookFile: null,
  options,
});

/** commit された理由を順に集める。**`isReady` の回は `null` が入る。** */
function mountEngine(initial: EngineRuntimeConfig | null) {
  const seen: (EngineNotReadyReason | null)[] = [];

  function Probe() {
    const { notReadyReason } = useEngine();
    useEffect(() => {
      // 同じ理由が続く描画は1つに畳む。見たいのは遷移で、描画の回数ではない。
      if (seen[seen.length - 1] !== notReadyReason) seen.push(notReadyReason);
    });
    return null;
  }

  const tree = (desired: EngineRuntimeConfig | null) => (
    <EngineProvider desiredRuntime={desired}>
      <Probe />
    </EngineProvider>
  );

  const utils = render(tree(initial));
  return {
    reasons: seen,
    async setRuntime(desired: EngineRuntimeConfig | null) {
      await act(async () => {
        utils.rerender(tree(desired));
      });
    },
    async settle() {
      await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    },
  };
}

beforeEach(() => {
  initialize.mockReset();
  shutdown.mockReset();
  initialize.mockResolvedValue(info);
  shutdown.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("EngineProvider が立てる理由", () => {
  it("エンジンを選んでいない間だけ no-engine", async () => {
    const view = mountEngine(null);
    await view.settle();
    expect(view.reasons).toEqual(["no-engine"]);
    expect(initialize).not.toHaveBeenCalled();

    await view.setRuntime(runtime());
    await view.settle();

    // 起動を待つ窓は `starting`。**`no-engine` を挟まない**——挟むと、解析側が
    // 「選び直すまで戻らない」と読んで走っている解析を打ち切る。
    expect(view.reasons).toEqual(["no-engine", "starting", null]);
  });

  it("起こし直している間も starting のまま", async () => {
    const view = mountEngine(runtime());
    await view.settle();
    expect(view.reasons).toEqual(["starting", null]);

    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    expect(view.reasons).toEqual(["starting", null, "starting", null]);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("畳むのに失敗して idle で止まった回も starting", async () => {
    const view = mountEngine(runtime());
    await view.settle();

    // 畳む invoke が落ちると `restart()` はそこで切れる。`phase` は `idle` に落ち、
    // **起動し直すのは下の effect の `idle` の枝**——待てば戻るので `starting`。
    shutdown.mockRejectedValueOnce(new Error("shutdown failed"));
    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    expect(view.reasons.slice(2)).toEqual(["starting", null]);
    expect(view.reasons).not.toContain("no-engine");
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("選択が外れたら no-engine で止まり、起動し直す口が無い", async () => {
    const view = mountEngine(runtime());
    await view.settle();
    expect(initialize).toHaveBeenCalledTimes(1);

    // 設定でプリセットを消す／必須欄を空にする／`aiRoot` を外す
    // （`entities/engine-presets` の `runtimeConfig` が null になる口）。
    await view.setRuntime(null);
    await view.settle();
    await view.settle();

    // **戻ってこない。** 解析側はこれを終端として読み、走っている解析を打ち切る。
    expect(view.reasons[view.reasons.length - 1]).toBe("no-engine");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("初期化が落ちたら failed で止まり、同じ設定では再トライしない", async () => {
    initialize.mockRejectedValue(new Error("boom"));

    const view = mountEngine(runtime());
    await view.settle();
    await view.settle();

    expect(view.reasons[view.reasons.length - 1]).toBe("failed");
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("設定が変われば failed からは再トライする", async () => {
    initialize.mockRejectedValueOnce(new Error("boom"));

    const view = mountEngine(runtime());
    await view.settle();
    expect(view.reasons[view.reasons.length - 1]).toBe("failed");

    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    // **`failed` が終端なのは「同じ設定なら」まで。** 断りが案内している操作
    // （オプションを変えて保存）はここへ来る。
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
  });
});
