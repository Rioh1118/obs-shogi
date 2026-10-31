import type { EngineNotReadyReason } from "@/entities/engine";

/**
 * 解析が利用者に返す断り。**枝ごとに1本ずつ持つ。**
 *
 * 復帰の手が違うものを同じ1文にすると、帯（`AnalysisRefusalBridge`）が「もう一度押す」のか
 * 「エンジンを起こし直す」のかを選べない。**どの文も次に何をすればよいかで終える**
 * （ADR-0004 の決定1）。起こし直し方は1箇所に置いてある
 * （`docs/state-transitions/engine.md` の ※5）。
 *
 * **ここに1本足したら、`docs/state-transitions/analysis.md` の ※15 にも枝を足すこと。**
 * `src/__tests__/analysisRefusals.test.ts` が突き合わせる。
 *
 * @packageDocumentation
 */

/** 上限まで待っても同期が追いつかない。**押し直しで直りうる。** */
export const POSITION_SYNC_TIMEOUT_MESSAGE =
  "局面の準備に時間が掛かっています。もう一度 ▶ を押してください。";
/** Rust が開始を断った（席が残っている。→ `docs/state-transitions/analysis.md` の ※11 / #172）。 */
export const START_REFUSED_MESSAGE = "検討を開始できませんでした。再起動してください。";
/** 利用者が起動を中止した。 */
export const ENGINE_CANCELLED_MESSAGE = "エンジンの起動を中止しました。もう一度起動してください。";
/** エンジンをまだ選んでいない。 */
export const NO_ENGINE_SELECTED_MESSAGE =
  "エンジンが起動していません。設定でエンジンを選択してください。";
/** 盤を動かした後の自動再開が落ちた。 */
export const RESTART_FAILED_MESSAGE = "検討を再開できませんでした。再起動してください。";

/**
 * 解析結果の購読に失敗した（→ E12 / F-4）。**結果が二度と届かない。**
 * 張り直す口が無い（effect はマウント1回きり）ので、復帰はアプリの起動し直し。
 */
export const LISTENERS_FAILED_MESSAGE = "検討の結果を受け取れません。アプリを再起動してください。";

/**
 * `EngineNotReadyReason` から断りへの対応。**割り当て漏れは tsc が落とす。**
 * `starting` と `failed` が無いのは断らないため（検討の意思を残し、語が言う）。
 */
export const NOT_READY_REFUSALS: Record<
  Exclude<EngineNotReadyReason, "starting" | "failed">,
  string
> = {
  "no-engine": NO_ENGINE_SELECTED_MESSAGE,
  cancelled: ENGINE_CANCELLED_MESSAGE,
};

/** 帯に「再起動する」を添える断り。**エンジンを起動し直せば直る見込みのある回だけ** */
const RESTART_REFUSALS: ReadonlySet<string> = new Set([
  START_REFUSED_MESSAGE,
  ENGINE_CANCELLED_MESSAGE,
  RESTART_FAILED_MESSAGE,
]);

export const refusalNeedsRestart = (refusal: string) => RESTART_REFUSALS.has(refusal);
