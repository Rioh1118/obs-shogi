// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import type { EngineInfo } from "@/entities/engine/api/rust-types";
import { info, mountEngine, runtime } from "./mountEngine";

/**
 * **起動の門が、畳む回と重なっても降りること。**
 *
 * ここだけ `engineInitializer` を差し替えず、**本物を通す**——差し替えた double は
 * `inFlight` を持たないので「畳む側が飛んでいる起動を待つか」を表現できず、
 * この窓はどう書いても再現しない（隣の `provider.test.tsx` の double がまさにそれ）。
 * 差し替えるのは IPC の4つだけ。
 *
 * 守っている性質: **起動を待っている間に `desiredRuntime` が2度外れて戻っても、
 * エンジンは起動し直し、追い越された畳みは後から起きたエンジンを殺さない。**
 * 前半が落ちると理由は `starting`（＝待てば戻る側）のまま固まり、走っている解析は
 * 誰にも断たれずに「解析中」を回し続ける（→ #502 と同じ症状）。
 *
 * **見ているのは世代の門4つ**——`provider.tsx` の `shutdown` が `await` の向こうで
 * `dispatch` を止めること、`api/initializer.ts` の `shutdown` が追い越されたら
 * IPC を撃たないこと、そして `initialize` が成功側・失敗側の両方で降りること。
 * **両者の `finally` の同一性判定だけは、観測できる差を作れていない**
 * （→ `docs/state-transitions/engine.md` の「埋まっていないセル」）。
 */
const initializeEngine = vi.fn<() => Promise<void>>();
const shutdownEngine = vi.fn<() => Promise<void>>();
const applyEngineSettings = vi.fn<() => Promise<void>>();
const getEngineInfo = vi.fn<() => Promise<EngineInfo | null>>();

vi.mock("../../api/tauri", () => ({
  initializeEngine: () => initializeEngine(),
  shutdownEngine: () => shutdownEngine(),
  applyEngineSettings: () => applyEngineSettings(),
  getEngineInfo: () => getEngineInfo(),
}));

beforeEach(() => {
  initializeEngine.mockReset();
  shutdownEngine.mockReset();
  applyEngineSettings.mockReset();
  getEngineInfo.mockReset();

  initializeEngine.mockResolvedValue(undefined);
  shutdownEngine.mockResolvedValue(undefined);
  applyEngineSettings.mockResolvedValue(undefined);
  getEngineInfo.mockResolvedValue(info);
});

afterEach(cleanup);

describe("起動の門", () => {
  it("起動を待っている間に設定が2度外れて戻っても、エンジンは起動し直す", async () => {
    // 起動が返らない状態を作る。**評価関数が大きくて初期化が長い回**がこれ。
    let releaseStart: () => void = () => {};
    initializeEngine.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountEngine(runtime());
    await view.settle();
    expect(initializeEngine).toHaveBeenCalledTimes(1);

    // 1度目: 適用中のプリセットが消えて設定が組み立てられなくなる（→ #518 の窓）。
    // 畳む側は飛んでいる起動を待つので、ここではまだ `idle` へ落ちない。
    await view.setRuntime(null);
    await view.settle();

    // 設定が戻る。`phase` はまだ `initializing` なので effect はどの枝にも入らない。
    await view.setRuntime(runtime());
    await view.settle();

    // 2度目: ここが要。**2本目の畳みは飛んでいる起動を待たずに戻り**、`phase` を
    // `idle` に落とす。門が bool だと、この時点で立てた者が居なくなる。
    await view.setRuntime(null);
    await view.settle();
    await view.setRuntime(runtime());
    await view.settle();

    // 1本目の起動がようやく返る。**1度目の畳みはこれを待っていた**ので、ここで
    // その継続が目を覚ます。世代を見ていなければ、いま `ready` になったエンジンへ
    // `shutdown_engine` を撃ち、`phase` を `idle` へ落として3本目を走らせる。
    releaseStart();
    await view.settle();
    await view.settle();

    // **門が降りていれば、ここまでに起動し直している。数で締める**——
    // `toBeGreaterThan(1)` だと、上の巻き添えで3本になった回も緑になる。
    //
    // **ここで固定しているのは「起動し直せること」だけ。** この並びは1本目が
    // 未解決のまま2本目が飛ぶ形で、**Rust 側はそれを直列化していない**
    // ——参照されないプロセスが1本残る（→ #525）。本数はここでは見ていない。
    expect(initializeEngine).toHaveBeenCalledTimes(2);
    expect(view.reasons[view.reasons.length - 1]).toBeNull();

    // 追い越された畳みは IPC を撃たない。**撃つと、殺されるのはいま起きたエンジン**
    // （Rust の `shutdown` は `engine_id` を無条件に take する）。
    expect(shutdownEngine).toHaveBeenCalledTimes(1);
  });

  /**
   * **起動を2本とも保留にする。**
   *
   * 2本目を決着させると、1本目が着地する**前から** `isReady` が真になり、
   * 理由の並びに `null` が入る——下の検査は「追い越された1本が `null` を名乗らないこと」を
   * 見るので、**欠陥が無くても落ちる**。2本目は飛ばしたままにしておくこと。
   */
  function twoPendingStarts() {
    let settleFirst: (e?: Error) => void = () => {};
    initializeEngine.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          settleFirst = (e) => (e ? reject(e) : resolve());
        }),
    );
    // 2本目は assert が済むまで返さない（上の doc）。
    //
    // **返さないまま終えない。** `engineInitializer` はモジュールの singleton なので、
    // 保留のまま `it` を抜けると次のテストの `initialize` が「飛んでいる起動」を
    // 引き継ぎ、IPC を1本も撃たない（`beforeEach` の `mockReset` では戻らない）。
    let settleSecond: () => void = () => {};
    initializeEngine.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settleSecond = resolve)),
    );
    return {
      settleFirst: (e?: Error) => settleFirst(e),
      settleSecond: () => settleSecond(),
    };
  }

  /** 上の窓を作る。畳みを2回通さないと `idle` に落ちず、2本目が飛ばない。 */
  async function openSecondStart(view: ReturnType<typeof mountEngine>) {
    await view.settle();
    await view.setRuntime(null);
    await view.settle();
    await view.setRuntime(runtime());
    await view.settle();
    await view.setRuntime(null);
    await view.settle();
    await view.setRuntime(runtime());
    await view.settle();
    expect(initializeEngine).toHaveBeenCalledTimes(2);
  }

  it("追い越された起動が着地しても、ready を名乗らない", async () => {
    const { settleFirst, settleSecond } = twoPendingStarts();
    const view = mountEngine(runtime());
    await openSecondStart(view);

    const from = view.reasons.length;
    settleFirst();
    await view.settle();

    // **`null` は「使える」の意味。** 2本目がまだ飛んでいるのに名乗ると ▶ が通り、
    // Rust は `NotInitialized` で断る——**正常に起動している最中に**
    // 「エンジンを起こし直してください」と案内することになる。
    try {
      expect(view.reasons.slice(from)).not.toContain(null);
      expect(view.reasons[view.reasons.length - 1]).toBe("starting");
    } finally {
      // **assert より後ろに置かない。** 落ちた回に保留が残ると、次のテストの
      // `initialize` が「飛んでいる起動」を引き継ぎ、**自分の assert ではなく
      // 足場で**落ちる——失敗の位置が原因を指さなくなる。
      settleSecond();
      await view.settle();
    }
  });

  it("追い越された起動が落ちても、終端を名乗らない", async () => {
    const { settleFirst, settleSecond } = twoPendingStarts();
    const view = mountEngine(runtime());
    await openSecondStart(view);

    const from = view.reasons.length;
    settleFirst(new Error("boom"));
    await view.settle();

    // **`failed` は終端。** 名乗ると `retriesAfterError` は同じ設定なので偽のまま、
    // 解析側が `ENGINE_FAILED_WHILE_ANALYZING_MESSAGE` で打ち切る
    // ——**健全なエンジンが起動している最中に**「使えなくなった」と告げて止める。
    try {
      expect(view.reasons.slice(from)).not.toContain("failed");
      expect(view.reasons[view.reasons.length - 1]).toBe("starting");
    } finally {
      settleSecond();
      await view.settle();
    }
  });
  /**
   * **畳みも世代を上げる。**
   *
   * 上げないと、畳みを待っている間に着地した起動が `initialize_success` を通し、
   * **利用者がもう捨てた設定**が `activeRuntime` に入る（→ `engine.md` の不変条件1）。
   * 理由の並びでは見えない——`desiredRuntime` が無い間は理由が `no-engine` に短絡するので、
   * ここだけ `phase` を見る。
   */
  it("畳みを待っている間に起動が着地しても、ready へ進まない", async () => {
    let settleStart: () => void = () => {};
    initializeEngine.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settleStart = resolve)),
    );
    // 畳みの IPC を止めて、着地と畳みを別の commit に割る。
    let settleShutdown: () => void = () => {};
    shutdownEngine.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settleShutdown = resolve)),
    );

    const view = mountEngine(runtime());
    await view.settle();

    // 設定が外れる。畳みは飛んでいる起動を待つ。
    await view.setRuntime(null);
    await view.settle();

    const from = view.phases.length;
    settleStart();
    await view.settle();

    expect(view.phases.slice(from)).not.toContain("ready");

    settleShutdown();
    await view.settle();
  });
  /**
   * **`initialize` の後始末は、自分が居座っているときだけ枠を空ける。**
   *
   * 無条件に空けると、追い越された1本が着地した時点で枠が空き、**次の畳みが
   * 飛んでいる起動を待たずに IPC を撃つ**——Rust の `shutdown` はそのとき載っている
   * プロセスを落とすので、起動処理中のエンジンが死ぬ。畳みは
   * `shutdown().catch(() => {})` で捨てられるので**画面には何も出ない**。
   */
  it("追い越された起動の後始末は、次の畳みが待つべき相手を消さない", async () => {
    // **2本目も保留にする。** 決着していると枠は自分の後始末で空くので差が出ない。
    const { settleFirst, settleSecond } = twoPendingStarts();
    const view = mountEngine(runtime());
    await openSecondStart(view);

    // 1本目が着地する。**枠を握っているのは2本目**——1本目は空けてはいけない。
    settleFirst();
    await view.settle();

    const before = shutdownEngine.mock.calls.length;

    // 3本目の畳み。**2本目がまだ飛んでいるので待つ側**——撃ってはいけない。
    await view.setRuntime(null);
    await view.settle();

    try {
      expect(shutdownEngine.mock.calls.length).toBe(before);
    } finally {
      settleSecond();
      await view.settle();
    }
  });
});
