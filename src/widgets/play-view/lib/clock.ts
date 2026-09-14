import type { ClocksView, Side } from "@/entities/game-session";

/** 片側の表示値。**どちらも「いま出す残り」**で、止まっている側は最後に届いた値 */
export interface ClockDisplay {
  mainMs: number;
  byoyomiMs: number;
  /** この側の時計が動いているか */
  running: boolean;
}

/**
 * 表示する残り時間。
 *
 * **減らすループを持たない。** 動いている側は「尽きる時刻 − いま」をクランプするだけで、
 * 「持ち時間を使い切ってから秒読みが減り始める」という規則は Rust の中にある
 * （`RunningClock` の doc）。こちらで減らすと、その規則が境界の両側に生える。
 *
 * **時間切れの判定に使わない。** 0 に見えても終局させるのは Rust。
 * ここの時刻は壁時計なので、飛べばずれる（次の更新で入れ直る）。
 */
export function clockDisplay(clocks: ClocksView, side: Side, now: number): ClockDisplay {
  const clock = clocks[side];
  const running = clocks.running;

  if (running === null || running.side !== side) {
    return { mainMs: clock.mainMs, byoyomiMs: clock.byoyomiMs, running: false };
  }

  return {
    mainMs: Math.max(0, running.mainZeroAt - now),
    // 秒読みは1手ごとに与え直されるので、設定値より大きく出さない
    byoyomiMs: Math.min(clock.byoyomiMs, Math.max(0, running.byoyomiZeroAt - now)),
    running: true,
  };
}

/**
 * `M:SS` か `H:MM:SS`。**切り上げる。**
 *
 * 切り捨てると、残り 1ms の時計が 0:00 を指したまま数えられる時間そのあいだ止まって見える
 * ——「0 なのに終局しない」は、時間切れの判定がこちらに無いことの症状に見えてしまう。
 */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 次に描き直すまでの間隔。**動いていないなら描き直さない**（`null`）。
 *
 * 秒の表示しか持たないので、1秒より細かく起こしても出る文字は変わらない。
 */
export function tickIntervalMs(clocks: ClocksView | null): number | null {
  return clocks?.running == null ? null : 1000;
}
