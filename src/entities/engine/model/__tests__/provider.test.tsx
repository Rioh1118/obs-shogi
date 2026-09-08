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
      seen.push(notReadyReason);
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
  it("起動の設定を組み立てられない間だけ no-engine", async () => {
    const view = mountEngine(null);
    await view.settle();
    expect(new Set(view.reasons)).toEqual(new Set(["no-engine"]));
    expect(initialize).not.toHaveBeenCalled();

    const from = view.reasons.length;
    await view.setRuntime(runtime());
    await view.settle();

    // 起動を待つ窓は `starting`。**`no-engine` を1枚も挟まない**——挟むと、解析側が
    // 戻らない側と読んで、走っている解析を打ち切る。**畳まずに数える**
    // （畳むと、直前が `no-engine` のときに挟まった1枚が吸われて検査が効かない）。
    expect(view.reasons.slice(from)).not.toContain("no-engine");
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
  });

  it("起こし直している間も starting のまま", async () => {
    const view = mountEngine(runtime());
    await view.settle();
    const from = view.reasons.length;

    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    // 起こし直しの窓を `no-engine` で通さない（同上）。
    expect(view.reasons.slice(from)).not.toContain("no-engine");
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
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

    // **起動し直すのは `idle` の枝。** その枝を消すと `initialize` は1回で止まる。
    expect(view.reasons).not.toContain("no-engine");
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("設定を組み立てられなければ、初期化に失敗していても no-engine", async () => {
    initialize.mockRejectedValue(new Error("boom"));

    const view = mountEngine(runtime());
    await view.settle();
    await view.settle();
    expect(view.reasons[view.reasons.length - 1]).toBe("failed");

    // **`desiredRuntime` の有無を先に見る。** `failed` を先に見ると、この窓で
    // 「オプションを変えて保存してください」と案内することになる
    // ——**起こし直す材料が揃っていない。**
    // `shutdown` を長引かせて窓を開けたまま観測する。
    let finishShutdown: () => void = () => {};
    shutdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve;
        }),
    );
    await view.setRuntime(null);

    expect(view.reasons[view.reasons.length - 1]).toBe("no-engine");

    await act(async () => {
      finishShutdown();
    });
    await view.settle();
    expect(view.reasons[view.reasons.length - 1]).toBe("no-engine");
  });

  it("設定が組み立てられなくなったら no-engine で止まり、起動し直す口が無い", async () => {
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

  it("同じ設定を入れ直しても起こし直さない", async () => {
    const view = mountEngine(runtime());
    await view.settle();
    expect(initialize).toHaveBeenCalledTimes(1);

    // **等値だが別のオブジェクト**を流す。`equalRuntime` が中身で比べていないと、
    // プリセットを保存し直すたびにエンジンが畳まれて起こし直る。
    await view.setRuntime(runtime());
    await view.settle();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
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
