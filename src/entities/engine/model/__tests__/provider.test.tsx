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

/**
 * 値は同じで**入れ物だけ新しい**設定。
 *
 * 実際に作るのは、選択中のプリセットの**編集**（`updatePreset` が `set_presets` で
 * 箱ごと差し替える。ラベルや解析の既定だけ直せば runtime の欄は同値）と、
 * プリセットの**読み直し**。同じプリセットを選び直しても `selectedPresetId` は
 * 動かないので、そちらでは `runtimeConfig` のメモが再計算されない
 */
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
    get state() {
      return engine.state;
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
   * 表の (S3, E4)。同じ runtime での再設定。
   *
   * `equalRuntime` は値で比べる。参照で比べる形に倒すと、プリセットを編集する
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
   * 表の (S3, E3)。別の runtime。**復帰の唯一の入口。**
   *
   * 帯の「設定を開く」が連れて行く先はここで、設定を直せば自動で起動し直す。
   * これが落ちると、帯の本文（「設定を直せば自動でもう一度起動します」）が嘘になる
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
/** 解決を外から決める promise。起動の途中に割り込む順序を作るのに使う */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("EngineProvider の起動中の切り替え", () => {
  /**
   * 表の (S1, E3)。起動中に別の設定になったら、**待たずに**その設定で起動し直す
   * （前の起動は Rust が落とし、前の呼び出しは `cancelled` で断られる）。
   *
   * 前の起動の結果を待ってから起こし直す形だと、`readyok` を返さないエンジンを
   * 選んだ回に、設定を直しても何も起きない
   */
  test("起動中に設定が変わったら、その設定で起動し直す", async () => {
    const first = deferred<EngineInfo>();
    initialize.mockReturnValueOnce(first.promise);
    initialize.mockResolvedValueOnce({ ...INFO, name: "Naoetsu" });

    const app = mountWith(RUNTIME);
    await settle();
    expect(app.phase).toBe("initializing");

    const next = { ...sameValues(), enginePath: "/ai/engines/naoetsu" };
    await app.setRuntime(next);
    await settle();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1][0].enginePath).toBe("/ai/engines/naoetsu");
    expect(app.phase).toBe("ready");
    expect(app.state.activeRuntime?.enginePath).toBe("/ai/engines/naoetsu");

    // 前の起動が遅れて断られても、後の起動の結果を上書きしない
    await act(async () => {
      first.reject({ kind: "cancelled", message: "the engine start was cancelled" });
    });
    expect(app.phase).toBe("ready");
    expect(app.state.error).toBeNull();
  });

  /** 表の (S1, E4)。同じ値の設定が来ただけなら起こし直さない */
  test("起動中に同じ値の設定が来ても、起こし直さない", async () => {
    const first = deferred<EngineInfo>();
    initialize.mockReturnValueOnce(first.promise);

    const app = mountWith(RUNTIME);
    await settle();
    await app.setRuntime(sameValues());
    await settle();

    expect(initialize).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(INFO);
    });
    expect(app.phase).toBe("ready");
  });

  /** 失敗は種類ごと state に載る（帯の文言は種類から組む） */
  test("失敗の種類を state に載せる", async () => {
    initialize.mockRejectedValueOnce({ kind: "exitedEarly", message: "engine exited" });

    const app = mountWith(RUNTIME);
    await settle();

    expect(app.phase).toBe("error");
    expect(app.state.error).toEqual({ kind: "exitedEarly", message: "engine exited" });
  });
});
