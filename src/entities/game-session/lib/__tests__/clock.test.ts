import { describe, expect, test } from "vitest";
import type { ClocksView } from "@/entities/game-session/api/rust-types";
import { clockDisplay, formatClock, tickIntervalMs } from "../clock";

const NOW = 1_700_000_000_000;

/**
 * 先手が動いている時計。
 *
 * **秒読みの期限は `mainZeroAt + byoyomiMs`。** 送り手が出す形がそれ1つなので
 * （`GameClocks::view`）、2つを独立に選べる fixture は送り手が作れない値になる。
 */
function running(mainZeroAt: number, byoyomiZeroAt = mainZeroAt + 30_000): ClocksView {
  return {
    black: { mainMs: 0, byoyomiMs: 30_000 },
    white: { mainMs: 600_000, byoyomiMs: 30_000 },
    running: { side: "black", mainZeroAt, byoyomiZeroAt },
  };
}

/** 動いている側の持ち時間の表示。**動かす値は `mainZeroAt` だけ** */
function mainAt(mainZeroAt: number, now: number): string {
  return formatClock(clockDisplay(running(mainZeroAt), "black", now).mainMs);
}

describe("clockDisplay", () => {
  test("動いている側は期限といまの差を出す", () => {
    const display = clockDisplay(running(NOW + 6_000, NOW + 36_000), "black", NOW);
    expect(display).toEqual({ mainMs: 6_000, byoyomiMs: 30_000, running: true });
  });

  test("動いていない側は最後に届いた値のまま", () => {
    const display = clockDisplay(running(NOW + 6_000, NOW + 36_000), "white", NOW);
    expect(display).toEqual({ mainMs: 600_000, byoyomiMs: 30_000, running: false });
  });

  /**
   * **期限は過去を指しうる。** 尽きた持ち時間は尽きた時刻のまま送られてくる
   * （`GameClocks::view`）ので、「いま」がそれを追い越した状態が秒読みの間ずっと続く。
   */
  test("過ぎた期限は 0 に張り付く", () => {
    const passed = running(NOW - 2_000, NOW + 28_000);

    expect(clockDisplay(passed, "black", NOW).mainMs).toBe(0);
    // 「いま」が1秒進んでも、出る値は動かない
    expect(clockDisplay(passed, "black", NOW + 1_000).mainMs).toBe(0);
    expect(clockDisplay(passed, "black", NOW + 60_000).mainMs).toBe(0);
  });

  /**
   * **受け手には点滅を止める手が無い。** 尽きた側の期限が送るたびに前へ進むと、
   * 受け手の「いま」は毎秒しか動かない（`useNow`）ので、差が 0 と1秒弱を往復し、
   * 切り上げが `0:00` と `0:01` を交互に出す。
   *
   * ここが固定しているのは**受け手が往復を作らないこと**（同じ期限には同じ表示）で、
   * **期限が動かないことの保証は送り手の側**
   * （`GameClocks::view` と `an_exhausted_deadline_does_not_advance_when_the_view_is_rebuilt`）。
   */
  test("期限が動く形を渡されたら往復する", () => {
    const shown: string[] = [];
    // 期限が emit のたびに「いま」へ貼り直される形（直す前の Rust が出していた値）
    for (let i = 0; i < 4; i += 1) {
      const emittedAt = NOW + i * 500;
      const now = NOW + Math.floor(i / 2) * 1000;
      shown.push(mainAt(emittedAt, now));
    }

    expect(shown).toEqual(["0:00", "0:01", "0:00", "0:01"]);
  });

  test("期限が動かなければ、いまが据え置かれても表示は動かない", () => {
    const shown: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const now = NOW + Math.floor(i / 2) * 1000;
      shown.push(mainAt(NOW - 2_000, now));
    }

    expect(shown).toEqual(["0:00", "0:00", "0:00", "0:00"]);
  });

  test("秒読みは設定値より大きく出さない", () => {
    // 持ち時間が残っている間、秒読みの期限は `持ち時間の期限 + 秒読み` にある
    const display = clockDisplay(running(NOW + 6_000, NOW + 36_000), "black", NOW);
    expect(display.byoyomiMs).toBe(30_000);
  });
});

describe("formatClock", () => {
  test("切り上げるので 0:00 は本当に 0 のときだけ", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(1_000)).toBe("0:01");
    expect(formatClock(1_001)).toBe("0:02");
  });

  test("負の値も 0:00", () => {
    expect(formatClock(-5_000)).toBe("0:00");
  });

  test("1時間を超えたら時を出す", () => {
    expect(formatClock(59_000)).toBe("0:59");
    expect(formatClock(600_000)).toBe("10:00");
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(3_661_000)).toBe("1:01:01");
  });
});

describe("tickIntervalMs", () => {
  test("動いている時計が無ければ描き直さない", () => {
    expect(tickIntervalMs(null)).toBeNull();
    expect(tickIntervalMs({ ...running(NOW, NOW), running: null })).toBeNull();
  });

  test("動いていれば毎秒", () => {
    expect(tickIntervalMs(running(NOW + 1_000, NOW + 31_000))).toBe(1_000);
  });
});
