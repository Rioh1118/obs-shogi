import type { TimeLimit } from "@/entities/game-session";

/**
 * 持ち時間の形。**排他にする。**
 *
 * 数値欄を並べて自由に入れさせると、通らない組み合わせ（秒読みと加算の併用）を
 * **「対局を始める」を押した後に**知ることになる。Rust 側は片側の中と
 * 先後をまたぐ組み合わせの2段で断るので、こちらは形を選ばせて組み立てる。
 *
 * **弾かれる形の一覧をここに写さない**（Rust 側が「数も一覧も1箇所」と決めている）。
 */
export type TimeControlKind =
  /** 切れ負け。持ち時間だけ */
  | "sudden"
  /** 秒読み。持ち時間は 0 でもよい */
  | "byoyomi"
  /** フィッシャー。指すたびに加算する。**秒読みとは併用できない** */
  | "fischer";

export interface TimeControl {
  kind: TimeControlKind;
  /** 分 */
  mainMinutes: number;
  /** 秒 */
  byoyomiSeconds: number;
  /** 秒 */
  incrementSeconds: number;
}

export const DEFAULT_TIME_CONTROL: TimeControl = {
  kind: "byoyomi",
  mainMinutes: 10,
  byoyomiSeconds: 30,
  incrementSeconds: 0,
};

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/**
 * 画面の値から Rust へ渡す形へ。**選んだ形に属さない欄は 0 にする。**
 *
 * 0 にしないと、秒読みの欄を触ってからフィッシャーに切り替えただけで
 * 「秒読みと加算の併用」になり、`start_game` が断る。
 */
export function toTimeLimit(control: TimeControl): TimeLimit {
  const mainMs = Math.max(0, Math.trunc(control.mainMinutes)) * MS_PER_MINUTE;

  switch (control.kind) {
    case "sudden":
      return { mainMs, byoyomiMs: 0, incrementMs: 0 };
    case "byoyomi":
      return {
        mainMs,
        byoyomiMs: Math.max(0, Math.trunc(control.byoyomiSeconds)) * MS_PER_SECOND,
        incrementMs: 0,
      };
    case "fischer":
      return {
        mainMs,
        byoyomiMs: 0,
        incrementMs: Math.max(0, Math.trunc(control.incrementSeconds)) * MS_PER_SECOND,
      };
  }
}

/**
 * その形として成立しているか。**押せるかどうかだけを決める。**
 *
 * Rust 側の検査を写しているのではなく、**押した後に断られることが分かっている形**を
 * 手前で止めるだけ。断りの文言は Rust のものをそのまま出す。
 */
export function isPlayableTimeControl(control: TimeControl): boolean {
  const limit = toTimeLimit(control);
  return limit.mainMs > 0 || limit.byoyomiMs > 0 || limit.incrementMs > 0;
}
