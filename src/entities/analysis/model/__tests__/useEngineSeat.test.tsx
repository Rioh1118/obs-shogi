// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useEngineSeat } from "../useEngineSeat";

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

    seat.hold("S1");

    // 握っている席を返す。応答は返らない。
    seat.releaseHeldQuietly("no-position");

    // 要らなくなった開始が持ってきた別の席を捨てる。**枠はこちらに移る。**
    seat.discard("late-restart", "S2");

    // その後ろに並ぶ返却。並ぶ相手を取り違えると、S1 の1本目がまだ飛んでいるのに撃つ。
    seat.releaseHeldQuietly("no-position");

    // 捨てる方の停止だけが先に解決する。
    pending.find((p) => p.sessionId === "S2")?.resolve();
    await new Promise((r) => setTimeout(r, 20));

    const shotsAtS1 = stopCore.mock.calls.filter(([sessionId]) => sessionId === "S1");
    expect(shotsAtS1).toHaveLength(1);
  });
});
