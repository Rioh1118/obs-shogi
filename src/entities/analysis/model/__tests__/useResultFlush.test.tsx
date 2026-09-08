// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef } from "react";

import { useResultFlush } from "../useResultFlush";
import { shortenWaits, waits } from "../waits";
import type { AnalysisResult } from "@/entities/engine";

const oneCandidate: AnalysisResult = { candidates: [{ rank: 1, pv_line: ["7g7f"] }] };

/** 実時間を進める。間引きは `setTimeout` を実時計で張る。 */
const advance = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

let restoreWaits: () => void = () => {};
beforeEach(() => {
  restoreWaits = shortenWaits();
});
afterEach(() => {
  restoreWaits();
  cleanup();
});

function mountFlush() {
  const dispatch = vi.fn();
  const view = renderHook(() => {
    // 解析中・席を握っている、を固定する。ここで見たいのは間引きだけ。
    const analyzing = useRef(true);
    return useResultFlush(dispatch, analyzing, () => true);
  });
  return { dispatch, flush: () => view.result.current };
}

describe("useResultFlush の間引き", () => {
  /**
   * **`info` は数十 ms 間隔で届く。** 来るたびに commit すると描画が追いつかないので、
   * 1周期に1回へ畳む。畳んでいるのは `schedule` の「既にタイマーが在れば何もしない」
   * 1枚だけで、落とすと `receive` のたびにタイマーが増える——`timerRef` は
   * 最後の1本しか覚えないので、古い分は誰にも消せない。
   */
  it("1周期の中に3本届いても、画面へ出すのは1回", async () => {
    const { dispatch, flush } = mountFlush();

    // **間を空けずに渡す。** 実時計で刻むと、遅い機械では1本目のタイマーが
    // 途中で起きて2回 commit し、門が効いていても赤くなる。
    // 門が見ているのは経過時間ではなく「タイマーが既に在るか」なので、
    // 間を空けなくても落とした版とは差が出る（落とすと3本張られて3回出る）。
    act(() => {
      flush().receive(oneCandidate);
      flush().receive(oneCandidate);
      flush().receive(oneCandidate);
    });
    await advance(waits().resultFlushMs * 3);

    expect(dispatch.mock.calls.filter(([a]) => a.type === "update_result")).toHaveLength(1);
  });
});
