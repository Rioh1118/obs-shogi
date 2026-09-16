// @vitest-environment happy-dom
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useNow } from "../useNow";

/**
 * 時計を描くための「いま」。
 *
 * **守るのは2つ。**
 *
 * - 止まっている間は起こさない（出る文字が変わらないので、描き直しが増えるだけ）
 * - **動き出した描画そのものに、止まっている間に進んだぶんが入る。**
 *   読み手（`HeaderGameLine`）はアプリの起動から常時 mount していて、
 *   対局と対局の間ずっと据え置かれる。1回でも古い値で描くと、
 *   `formatClock` は1時間を境に桁が増えるので「残り 2:07:48」のような値が出る
 */

const T0 = 1_700_000_000_000;

/**
 * commit された「いま」。**描画ごとではなく commit ごとに積む。**
 *
 * 描画の回数で見ると差が出ない —— 描画中に入れ直す形は捨てられる描画を1回挟むので、
 * 返り値の列は `useEffect` で入れ直す形と同じになる。**違うのは、その古い値が
 * 画面に出たかどうか**で、それは commit の有無。
 */
const seen: number[] = [];

function Probe({ intervalMs }: { intervalMs: number | null }) {
  const now = useNow(intervalMs);
  useLayoutEffect(() => {
    seen.push(now);
  });
  return null;
}

beforeEach(() => {
  seen.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNow", () => {
  test("止まっている間は起こさない", () => {
    render(<Probe intervalMs={null} />);
    const before = seen.length;

    act(() => {
      vi.setSystemTime(T0 + 10_000);
      vi.advanceTimersByTime(10_000);
    });

    expect(seen.length, "止まっているのに描き直している").toBe(before);
    expect(seen[0]).toBe(T0);
  });

  test("動いている間は間隔ごとに進む", () => {
    render(<Probe intervalMs={1_000} />);

    act(() => {
      // **`setSystemTime` を重ねない。** 偽の時計は `advanceTimersByTime` でも進む
      vi.advanceTimersByTime(1_000);
    });

    expect(seen[seen.length - 1]).toBe(T0 + 1_000);
  });

  /**
   * **据え置きの時間に上限は無い。** 前の対局が終わってから次の対局の最初の
   * `turnChanged` までずっと止まるので、ここで1回古い値を返すと、その1描画が
   * 「据え置いた時間ぶん多い残り時間」になる
   */
  test("動き出した描画に、止まっている間に進んだぶんが入る", () => {
    const { rerender } = render(<Probe intervalMs={null} />);

    act(() => {
      vi.setSystemTime(T0 + 2 * 60 * 60 * 1000);
    });
    act(() => {
      rerender(<Probe intervalMs={1_000} />);
    });

    expect(
      seen.filter((at) => at === T0).length,
      `古い「いま」のまま commit した回がある: ${seen.map((at) => at - T0).join(", ")}`,
    ).toBe(1);
    expect(seen[seen.length - 1]).toBe(T0 + 2 * 60 * 60 * 1000);
  });

  test("止まるときは入れ直さない", () => {
    const { rerender } = render(<Probe intervalMs={1_000} />);

    act(() => {
      vi.advanceTimersByTime(5_000);
      rerender(<Probe intervalMs={null} />);
    });

    // 止まった側の時計は最後に届いた残りで描くので、「いま」を進める理由が無い
    expect(seen[seen.length - 1]).toBe(T0 + 5_000);
  });
});
