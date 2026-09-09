// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { EngineInfo } from "@/entities/engine/api/rust-types";
import type { EngineContextType, EngineRuntimeConfig } from "../types";

/**
 * 失敗（`engine.md` の S3）から抜ける道を固定する。
 *
 * **同じ設定のまま再トライしない**のは無限リトライを避けるためで、直すべき
 * 振る舞いではない（ADR-0004 の F-9 も「押しても直らない」側に置いている）。
 * ただしこれを落とすと、パスが無いまま毎フレーム起動しにいく形に戻る——
 * その形は画面からは「重い」としか見えないので、ここで止める。
 */

const initialize = vi.fn<(runtime: EngineRuntimeConfig) => Promise<EngineInfo>>();
const shutdown = vi.fn<() => Promise<void>>();

vi.mock("@/entities/engine/api/initializer", () => ({
  engineInitializer: {
    initialize: (runtime: EngineRuntimeConfig) => initialize(runtime),
    shutdown: () => shutdown(),
  },
}));

const { EngineProvider } = await import("../provider");
const { useEngine } = await import("../useEngine");

const RUNTIME: EngineRuntimeConfig = {
  enginePath: "/ai/engines/yaneuraou",
  workDir: "/ai/yaneuraou",
  evalDir: "/ai/eval/suisho",
  bookDir: null,
  bookFile: null,
  options: { MultiPV: "1" },
};

/** 値は同じで**入れ物だけ新しい**設定。プリセットを選び直すと実際にこれが来る */
const sameValues = (): EngineRuntimeConfig => ({ ...RUNTIME, options: { ...RUNTIME.options } });

const INFO: EngineInfo = { name: "YaneuraOu", author: "yaneurao", options: [] };

function mountWith(runtime: EngineRuntimeConfig) {
  let engine!: EngineContextType;

  function Probe() {
    engine = useEngine();
    return null;
  }

  const app = (desired: EngineRuntimeConfig) => (
    <EngineProvider desiredRuntime={desired}>
      <Probe />
    </EngineProvider>
  );

  const view = render(app(runtime));

  return {
    /** 設定が入れ替わった、を実物と同じ順序で起こす */
    async setRuntime(next: EngineRuntimeConfig) {
      await act(async () => {
        view.rerender(app(next));
      });
    },
    get phase() {
      return engine.state.phase;
    },
  };
}

/** 起動の promise を掴んだまま次へ進めないので、reject が伝わるまで待つ */
const settle = () => act(async () => {});

beforeEach(() => {
  initialize.mockReset();
  shutdown.mockReset();
  shutdown.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("EngineProvider の失敗からの復帰", () => {
  /**
   * （表の S3 / E4）同じ runtime での再設定。
   *
   * `equalRuntime` は値で比べる。参照で比べる形に倒すと、プリセットを選び直す
   * たびに起動し直すことになり、**落ちる設定なら落ち続ける**
   */
  test("同じ値の設定が来ても、失敗したまま再トライしない", async () => {
    initialize.mockRejectedValue(new Error("no such file"));

    const app = mountWith(RUNTIME);
    await settle();
    expect(app.phase).toBe("error");
    expect(initialize).toHaveBeenCalledTimes(1);

    await app.setRuntime(sameValues());

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(app.phase).toBe("error");
  });

  /**
   * （表の S3 / E3）別の runtime。**復帰の唯一の入口。**
   *
   * 帯の「設定を開く」が連れて行く先はここで、設定を直せば自動で起動し直す。
   * これが落ちると、帯の本文（「直すと自動でもう一度起動します」）が嘘になる
   */
  test("設定を直せば、失敗したままでも起動し直す", async () => {
    initialize.mockRejectedValueOnce(new Error("no such file"));
    initialize.mockResolvedValueOnce(INFO);

    const app = mountWith(RUNTIME);
    await settle();
    expect(app.phase).toBe("error");

    await app.setRuntime({ ...sameValues(), enginePath: "/ai/engines/naoetsu" });
    await settle();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(app.phase).toBe("ready");
  });
});
