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

/**
 * 画面が持つ持ち時間。**欄は打った文字列のまま持つ。**
 *
 * 数へ直して持つと、`Number("")` の 0 が欄に居座って**空にできなくなる**し、
 * `Number("１０")` の `NaN` はそのまま `NaN` と表示されて1文字ずつ消しても戻らない。
 * 数に直すのは送る直前の1箇所（{@link toTimeLimit}）だけにする。
 */
export interface TimeControl {
  kind: TimeControlKind;
  /** 分 */
  mainMinutes: string;
  /** 秒 */
  byoyomiSeconds: string;
  /** 秒 */
  incrementSeconds: string;
}

export const DEFAULT_TIME_CONTROL: TimeControl = {
  kind: "byoyomi",
  mainMinutes: "10",
  byoyomiSeconds: "30",
  incrementSeconds: "0",
};

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/**
 * 1つの欄に入れてよい上限。**Rust の `MAX_TIME_MS` と同じ値を持つ。**
 *
 * **写しであることを機械が見ている**（`src/__tests__/timeLimitCap.test.ts`）。
 * 片方だけ動かすと落ちるので、Rust 側が上げたらここも上がる。
 *
 * 写さずに済ませられない —— 上限を知らないと、超えた値でも「押せる」を出したまま
 * **棋譜のファイルを作ってから** `start_game` が断る。
 * 断りは Rust の英文（`main time must not exceed ...`）で、使われない棋譜が1枚残る。
 */
export const MAX_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * 欄の値を、単位を掛けたミリ秒へ。**有限でなければ 0。**
 *
 * 欄は打った文字列なので `Number("１０")` も `Number("あ")` も `NaN` になる。
 * **`Math.max(0, …)` は `NaN` を吸わない** ——通すと `mainMs: NaN` が
 * `JSON.stringify` で `null` になり、Rust の `u64` が取り込みで落ちる。
 * そのときには棋譜のファイルが既に作られているので、**押す前に止める**
 * （{@link timeControlProblem} が 0 を見て押させない）。
 *
 * **有限かどうかは掛けた後に見る。** 掛ける前だけで見ると `1e308` が通り、
 * 分を掛けた時点で `Infinity` になる —— `NaN` と同じく `null` として送られ、
 * **`validate` にすら届かず取り込みで落ちる**（断りの文言も serde のものになる）。
 */
function msOf(value: string, unit: number): number {
  const parsed = Number(value.trim());
  const scaled = Math.max(0, Math.trunc(parsed)) * unit;
  return Number.isFinite(scaled) ? scaled : 0;
}

/**
 * 画面の値から Rust へ渡す形へ。**選んだ形に属さない欄は 0 にする。**
 *
 * 0 にしないと、秒読みの欄を触ってからフィッシャーに切り替えただけで
 * 「秒読みと加算の併用」になり、`start_game` が断る。
 */
export function toTimeLimit(control: TimeControl): TimeLimit {
  const mainMs = msOf(control.mainMinutes, MS_PER_MINUTE);

  switch (control.kind) {
    case "sudden":
      return { mainMs, byoyomiMs: 0, incrementMs: 0 };
    case "byoyomi":
      return {
        mainMs,
        byoyomiMs: msOf(control.byoyomiSeconds, MS_PER_SECOND),
        incrementMs: 0,
      };
    case "fischer":
      return {
        mainMs,
        byoyomiMs: 0,
        incrementMs: msOf(control.incrementSeconds, MS_PER_SECOND),
      };
  }
}

/**
 * 押せない理由。**押せるなら `null`。**
 *
 * **真偽値にしない。** 理由が2つあるので、1つの文言にまとめると
 * 片方の回に**当たっていない案内**が出る（上限を超えているのに
 * 「半角数字で入れてください」と言う形）。
 *
 * Rust 側の検査を写しているのではなく、**押した後に断られることが分かっている形**を
 * 手前で止めるだけ。ここで止めないと、断られる前に棋譜のファイルが作られる。
 */
export type TimeControlProblem =
  /** 3つとも 0。数でない入力（全角・空欄）もここに来る */
  | "empty"
  /** どれかが {@link MAX_TIME_MS} を超えている */
  | "too-long";

export function timeControlProblem(control: TimeControl): TimeControlProblem | null {
  const limit = toTimeLimit(control);
  const fields = [limit.mainMs, limit.byoyomiMs, limit.incrementMs];

  // **上限を先に見る。** 後にすると、上限を超えた欄しか埋めていない形が
  // 「3つとも 0 ではない」を先に通って `empty` にならず、順序に意味が出る
  if (fields.some((ms) => ms > MAX_TIME_MS)) return "too-long";
  if (fields.every((ms) => ms === 0)) return "empty";

  return null;
}
