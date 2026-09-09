// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useEngineSeat } from "../useEngineSeat";
import type { AnalysisSessionId } from "@/entities/engine/api/tauri";

/** Rust が鋳造する識別子を、テストの中で作る。 */
const id = (value: string) => value as AnalysisSessionId;

/**
 * エンジンが使えるかの述語。**ここで見たいのは席の出し入れ**なので、
 * 常に真を返す（エンジンが消える筋は `engineGenRef` を動かす `onEngineGone` で作る）。
 */
const ready = () => true;

const stopCore = vi.fn<(sessionId?: string, by?: string) => Promise<void>>();
vi.mock("@/entities/engine/api/tauri", () => ({
  stopAnalysis: (sessionId?: string, by?: string) => stopCore(sessionId, by),
}));

beforeEach(() => {
  stopCore.mockReset();
});
afterEach(cleanup);

/**
 * **`AnalysisProvider` を通さずに口を直に並べる。**
 *
 * ここで見るのは、フックが自分で名乗っている不変条件——同じ席へ2本目を並べて撃たない
 * ——が**公開の口の合法な並び**で保たれるか。いまの provider はこの順序を作らないが、
 * 保証しているのは provider の都合であってフックではない。口を1つ足した人が踏む。
 */
describe("EngineSeat の枠", () => {
  it("捨てる停止を挟んでも、飛んでいる返却と同じ席へ2本目を撃たない", async () => {
    const pending: { resolve: () => void; sessionId?: string }[] = [];
    stopCore.mockImplementation(
      (sessionId?: string) =>
        new Promise<void>((resolve) => {
          pending.push({ resolve, sessionId });
        }),
    );

    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    seat.beginTake("late-start", ready).landed(id("S1"), () => false);

    // 握っている席を返す。応答は返らない。
    seat.releaseHeldQuietly("no-position");

    // 要らなくなった開始が持ってきた別の席を捨てる。**枠はこちらに移る。**
    seat.beginTake("late-restart", ready).landed(id("S2"), () => true);

    // その後ろに並ぶ返却。並ぶ相手を取り違えると、S1 の1本目がまだ飛んでいるのに撃つ。
    seat.releaseHeldQuietly("no-position");

    // 捨てる方の停止だけが先に解決する。
    pending.find((p) => p.sessionId === "S2")?.resolve();
    await new Promise((r) => setTimeout(r, 20));

    const shotsAtS1 = stopCore.mock.calls.filter(([sessionId]) => sessionId === "S1");
    expect(shotsAtS1).toHaveLength(1);
  });
});

/**
 * 席を取る往復の**行きと帰りでエンジンが違う**回。設定でオプションを変えて保存すると
 * 踏む（この画面の断りが案内している操作）。
 */
describe("EngineSeat とエンジンの世代", () => {
  it("札を取った後にエンジンが消えたら、着地した席を握らない", () => {
    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    // 開始を頼む行。この時点のエンジンが札に焼き付く。
    const take = seat.beginTake("late-restart", ready);

    seat.onEngineGone();

    expect(take.landed(id("S1"), () => false)).toBe("engine-gone");
    // 握ると「解析中の表示のまま数字が動かない」に落ちる。
    expect(seat.isHeld()).toBe(false);
    // **撃たない。** 席が空の回の停止は、起こし直したエンジンへ裸の `stop` を書く。
    expect(stopCore).not.toHaveBeenCalled();
    // 遅れて届く `info` は落とす。
    expect(seat.accepts(id("S1"))).toBe(false);
  });

  it("停止が落ちても、その往復の間に消えたエンジンの席は書き戻さない", async () => {
    let rejectStop: (e: unknown) => void = () => {};
    stopCore.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStop = reject;
        }),
    );

    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    seat.beginTake("late-start", ready).landed(id("S1"), () => false);

    // 返却が飛んでいる間にエンジンが消える。
    const releasing = seat.releaseHeld("restart").catch(() => {});
    seat.onEngineGone();
    rejectStop(new Error("ipc gone"));
    await releasing;

    // 書き戻すと、以後の停止が**次のエンジン**へ `S1` を指して飛ぶ。
    expect(seat.isHeld()).toBe(false);

    stopCore.mockReset();
    stopCore.mockResolvedValue(undefined);
    await seat.releaseHeld("start");
    expect(stopCore).not.toHaveBeenCalled();
  });

  /**
   * 席を返している往復の最中にエンジンが消えた回。
   *
   * **世代だけでは足りない。** 札を取るのは席を返した後なので、その往復の最中に
   * 起こし直されると**進んだ後の世代が焼き付く**——世代差は 0 のまま。
   * 握ってしまうと、死んだエンジンの席を持ったまま「解析中」で固まり、
   * エンジンが戻っても再開しない（どの門も閉じたままになる）。
   */
  it("エンジンが使えなくなっていたら、着地した席を握らない", () => {
    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    let usable = true;
    const take = seat.beginTake("late-restart", () => usable);

    // 往復の最中に起こし直される。**世代は動かない**（札より前に進んだ扱い）。
    usable = false;

    expect(take.landed(id("S1"), () => false)).toBe("engine-gone");
    expect(seat.isHeld(), "死んだエンジンの席を握っている").toBe(false);
  });

  /**
   * 畳まれた後に**2本**着地して、どちらの捨てる停止も落ちる回。
   *
   * **provider はこの並びを作らない**（`beginTake` の呼び手は1本で、飛んでいる往復も
   * たかだか1本）。それでも見るのは、保証しているのが provider の都合であって
   * フックではないため——畳まれた印を1回で倒すと、2本目の書き戻しが黙って
   * 取り残され、その席は Rust に残る（#441）。
   */
  it("畳まれた後に2本戻ってきたら、2本とも返し直す", async () => {
    const rejects: ((e: unknown) => void)[] = [];
    stopCore.mockImplementation((sessionId?: string) =>
      sessionId === undefined
        ? Promise.resolve()
        : new Promise<void>((_resolve, reject) => {
            rejects.push(reject);
          }),
    );

    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    const first = seat.beginTake("late-start", ready);
    const second = seat.beginTake("late-restart", ready);

    seat.sweepOnUnmount();

    // 枠に並んだ停止が解決し切るまで進める。
    const settle = () => new Promise((r) => setTimeout(r, 0));

    // 1本目が着地して捨てられ、その停止が落ちる → 書き戻し → 撃ち直す。
    first.landed(id("S1"), () => true);
    rejects.shift()?.(new Error("ipc gone"));
    await settle();

    // 2本目も同じ。**ここを落とすと席が残る。**
    second.landed(id("S2"), () => true);
    rejects.shift()?.(new Error("ipc gone"));
    await settle();

    // **名前が約束しているのは「返し直す」。** 欄が空いたかだけを見ると、
    // 撃たずに欄を空ける変異が素通りする。
    expect(stopCore.mock.calls.filter(([s]) => s === undefined)).toHaveLength(2);
    expect(seat.isHeld(), "2本目の席が返らずに残っている").toBe(false);
  });
});
