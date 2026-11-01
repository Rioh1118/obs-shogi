// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useEngineSeat } from "../useEngineSeat";
import type { AnalysisSessionId } from "@/entities/analysis/api/tauri";

/** Rust が鋳造する識別子を、テストの中で作る。 */
const id = (value: string) => value as AnalysisSessionId;

/**
 * エンジンが使えるかの述語。**ここで見たいのは席の出し入れ**なので、
 * 常に真を返す（エンジンが消える筋は `engineGenRef` を動かす `onEngineGone` で作る）。
 */
const ready = () => true;

const stopCore =
  vi.fn<(sessionId?: string, by?: string) => Promise<"stopped" | "unanswered" | void>>();
vi.mock("@/entities/analysis/api/tauri", () => ({
  stopAnalysis: (sessionId?: string, by?: string) => stopCore(sessionId, by),
}));

beforeEach(() => {
  stopCore.mockReset();
});
afterEach(cleanup);

/**
 * 公開の関数のどの並びでも、同じ席へ2本目の停止を送らない。
 *
 * `AnalysisProvider` を通さずに関数を直に並べる。いまの provider はこの順序を作らないが、
 * それは provider の都合で、フックの保証ではない。呼び手を足すと踏む。
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

    seat.beginTake("late-start", ready).receiveSeat(id("S1"), () => false);

    // 握っている席を返す。応答は返らない。
    seat.releaseHeldQuietly("no-position");

    // 要らなくなった開始が持ってきた別の席を捨てる。**枠はこちらに移る。**
    seat.beginTake("late-restart", ready).receiveSeat(id("S2"), () => true);

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

    expect(take.receiveSeat(id("S1"), () => false)).toBe("engine-gone");
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

    seat.beginTake("late-start", ready).receiveSeat(id("S1"), () => false);

    // 返却が飛んでいる間にエンジンが消える。
    const releasing = seat.releaseHeld("restart").catch(() => {});
    seat.onEngineGone();
    rejectStop(new Error("ipc gone"));
    await releasing;

    // 書き戻すと、以後の停止が**次のエンジン**へ `S1` を指して飛ぶ。
    expect(seat.isHeld()).toBe(false);

    stopCore.mockReset();
    stopCore.mockResolvedValue("stopped");
    await seat.releaseHeld("start");
    expect(stopCore).not.toHaveBeenCalled();
  });

  /**
   * 席を返す往復の最中にエンジンが消えても、返った席を握らない。
   *
   * `beginTake` は席を返した後に呼ぶので、その往復の最中に起動し直されると進んだ後の世代が入り、
   * 世代差は0のまま。握ると死んだエンジンの席を持ったまま `検討中` で固まり、エンジンが戻っても
   * 再開しない。
   */
  it("エンジンが使えなくなっていたら、着地した席を握らない", () => {
    const { result } = renderHook(() => useEngineSeat());
    const seat = result.current;

    let usable = true;
    const take = seat.beginTake("late-restart", () => usable);

    // 往復の最中に起こし直される。**世代は動かない**（札より前に進んだ扱い）。
    usable = false;

    expect(take.receiveSeat(id("S1"), () => false)).toBe("engine-gone");
    expect(seat.isHeld(), "死んだエンジンの席を握っている").toBe(false);
  });

  /**
   * アンマウント後に2本の席が返り、どちらの捨てる停止も落ちても、2本とも返し直す。
   *
   * provider はこの並びを作らないが、それは provider の都合で、フックの保証ではない。
   * `unmountedRef` を1回で倒すと、2本目の書き戻しが取り残され、その席が Rust に残る。
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
    first.receiveSeat(id("S1"), () => true);
    rejects.shift()?.(new Error("ipc gone"));
    await settle();

    // 2本目も同じ。**ここを落とすと席が残る。**
    second.receiveSeat(id("S2"), () => true);
    rejects.shift()?.(new Error("ipc gone"));
    await settle();

    // **名前が約束しているのは「返し直す」。** 欄が空いたかだけを見ると、
    // 撃たずに欄を空ける変異が素通りする。
    expect(stopCore.mock.calls.filter(([s]) => s === undefined)).toHaveLength(2);
    expect(seat.isHeld(), "2本目の席が返らずに残っている").toBe(false);
  });
});
