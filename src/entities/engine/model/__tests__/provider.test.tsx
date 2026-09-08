// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import { EngineProvider } from "../provider";
import { useEngine } from "../useEngine";
import { isRecoverableNotReady } from "@/entities/engine/lib/notReadyReason";
import type { EngineNotReadyReason, EngineRuntimeConfig } from "../types";
import type { EngineInfo } from "@/entities/engine/api/rust-types";
import type { EngineInitializer } from "@/entities/engine/api/initializer";

/**
 * **見るのは `notReadyReason` の並びと、そこに至る `initialize` / `shutdown` の
 * 呼び出し回数。`phase` の値そのものは見ない。**
 *
 * この理由は解析側が「解析を打ち切るか、待つか」を決めるのに使う
 * （`docs/state-transitions/analysis.md` の ※5）ので、**どの窓でどれが立つか**が
 * 振る舞いそのもの。`phase` を見ても、待てば戻る窓と戻らない窓は区別できない。
 *
 * **起動の門が畳む回と重なる窓はここでは見られない**——下の double は `inFlight` を
 * 持たないので「畳む側が飛んでいる起動を待つか」を表現できない。`startGate.test.tsx` が
 * 本物の initializer を通して見る。
 */
const initialize = vi.fn<(runtime: EngineRuntimeConfig) => Promise<EngineInfo>>();
const shutdown = vi.fn<() => Promise<void>>();
// **差し替えも契約で縛る。** `satisfies` が無いと、`EngineInitializer` の署名が
// 動いてもこの double だけ古いまま緑になる。
vi.mock("../../api/initializer", () => ({
  engineInitializer: {
    initialize: (runtime: EngineRuntimeConfig) => initialize(runtime),
    shutdown: () => shutdown(),
  } satisfies EngineInitializer,
}));

const info = { name: "test-engine", author: "t", options: [] } satisfies EngineInfo;

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
    expect(view.reasons.slice(from)).toContain("starting");
    expect(view.reasons.slice(from)).not.toContain("no-engine");
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
  });

  it("起こし直している間も starting のまま", async () => {
    const view = mountEngine(runtime());
    await view.settle();
    const from = view.reasons.length;

    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    // 起こし直しの窓は `starting` を通り、`no-engine` は通さない。
    expect(view.reasons.slice(from)).toContain("starting");
    expect(view.reasons.slice(from)).not.toContain("no-engine");
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("畳むのに失敗して idle で止まった回も starting", async () => {
    const view = mountEngine(runtime());
    await view.settle();

    // 畳む invoke が落ちると `restart()` はそこで切れる。`phase` は `idle` に落ち、
    // **起動し直すのは下の effect の `idle` の枝**——待てば戻るので `starting`。
    const from = view.reasons.length;
    shutdown.mockRejectedValueOnce(new Error("shutdown failed"));
    await view.setRuntime(runtime({ Threads: "4" }));
    await view.settle();

    // **起動し直すのは `idle` の枝。** その枝を消すと `initialize` は1回で止まる。
    expect(view.reasons.slice(from)).toContain("starting");
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

  /**
   * **分類を、現物の振る舞いから引き直す。**
   *
   * `isRecoverableNotReady` は綴りの表（`RECOVERABLE_NOT_READY_REASONS`）で、
   * それを決めているのは下の effect のどの枝が起動し直すか。**表と枝は機械的に
   * 結ばれていない**ので、枝を1つ足した人が表を直さなくても何も赤くならない
   * ——理由が増えた回だけを tsc が見て、既存の理由の分類が動いた回は素通りする。
   *
   * ここで結ぶ。**`EngineNotReadyReason` の全値を回す**ので、理由が増えた回に
   * 「窓の作り方が無い」で落ちる（0件で黙らない）。
   */
  describe("分類が現物と合っている", () => {
    /**
     * その理由の窓を作り、**戻す口**を返す。
     *
     * 戻る側は「待てば ready へ着く」ので、待つ相手（飛んでいる起動）を解決する口を持つ。
     * 戻らない側は持たない——**その有無を検査が両方向で見る**ので、分類を入れ替えると
     * どちらの枝でも落ちる。永久に返らない promise で作ると、戻る側も戻らない側も
     * 「動かない」で同じに見え、検査が分類の定義を言い直すだけになる。
     */
    type ReasonWindow = {
      view: ReturnType<typeof mountEngine>;
      /** 飛んでいる起動を返す口。**戻る側だけが持つ。** */
      resolveStart: (() => void) | null;
    };

    const enter: Record<EngineNotReadyReason, () => ReasonWindow> = {
      // 設定を組み立てられない。選び直すまで起動する口が無い
      "no-engine": () => ({ view: mountEngine(null), resolveStart: null }),
      // 起動待ち。飛んでいる起動が返れば ready へ着く
      starting: () => {
        let settleStart: (info: EngineInfo) => void = () => {};
        initialize.mockImplementation(
          () =>
            new Promise<EngineInfo>((resolve) => {
              settleStart = resolve;
            }),
        );
        return { view: mountEngine(runtime()), resolveStart: () => settleStart(info) };
      },
      // 同じ設定のまま初期化が落ちた。飛んでいる起動はもう無い
      failed: () => {
        initialize.mockRejectedValue(new Error("boom"));
        return { view: mountEngine(runtime()), resolveStart: null };
      },
    };

    it.each(Object.keys(enter) as EngineNotReadyReason[])(
      "%s は、戻る側なら待てば ready へ着き、戻らない側なら二度と起動しない",
      async (reason) => {
        const { view, resolveStart } = enter[reason]();
        await view.settle();
        await view.settle();

        expect(view.reasons[view.reasons.length - 1]).toBe(reason);
        const callsWhileStuck = initialize.mock.calls.length;

        if (isRecoverableNotReady(reason)) {
          // **戻す口が在る。** 分類を入れ替えると、口を持たない理由がここへ来て落ちる。
          expect(resolveStart, `${reason} は戻る側なのに、待つ相手が居ない`).not.toBeNull();
          await act(async () => {
            resolveStart!();
          });
          await view.settle();
          expect(view.reasons[view.reasons.length - 1]).toBeNull();
        } else {
          // **戻らない側は、放っておいても起動を試みない。** ここが偽になると、
          // 解析側は再トライの最中に打ち切って「使えなくなった」と案内する。
          expect(resolveStart, `${reason} は戻らない側なのに、待つ相手が居る`).toBeNull();
          await view.settle();
          await view.settle();
          expect(initialize.mock.calls.length).toBe(callsWhileStuck);
          expect(view.reasons[view.reasons.length - 1]).toBe(reason);
        }
      },
    );
  });

  it("StrictMode で二重にマウントしても、起動は1回", async () => {
    // **門は描画のクロージャではなく ref。** `state.phase` を見る門は、同じコミットで
    // setup が2回走る回に `initialize_start` を撃った後でも `"idle"` のまま見える。
    render(
      <StrictMode>
        <EngineProvider desiredRuntime={runtime()}>
          <div />
        </EngineProvider>
      </StrictMode>,
    );
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("初期化が落ちた後に設定が動いたら、再トライを待つ窓は starting", async () => {
    // 初回の起動が返る前にプリセットを切り替え、その後で最初の起動が落ちた回。
    // `lastTried` は切り替える前の設定のまま `phase` が `error` に入る。
    let failFirst: (e: unknown) => void = () => {};
    initialize.mockImplementationOnce(
      () =>
        new Promise<EngineInfo>((_resolve, reject) => {
          failFirst = reject;
        }),
    );

    const view = mountEngine(runtime());
    await view.settle();

    await view.setRuntime(runtime({ Threads: "4" }));
    await act(async () => {
      failFirst(new Error("boom"));
    });

    // **ここを `failed` にしない。** 下の effect は設定が動いているので起動し直す
    // ——その窓で解析を打ち切ると、エンジンだけが黙って戻り、盤の下は止まったまま
    // 「使えなくなった」の断りが残る。
    expect(view.reasons).not.toContain("failed");

    await view.settle();
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(2);
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
