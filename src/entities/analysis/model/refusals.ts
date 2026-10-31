import type { EngineNotReadyReason } from "@/entities/engine";

/**
 * 解析が利用者に返す断り。**枝ごとに1本ずつ持つ。**
 *
 * 復帰の手が違うものを同じ1文にすると、読み手（→ #277）が「もう一度押す」のか
 * 「エンジンを起こし直す」のかを選べない。**どの文も次に何をすればよいかで終える**
 * （ADR-0004 の決定1）。起こし直し方は1箇所に置いてある
 * （`docs/state-transitions/engine.md` の ※5）。
 *
 * **ここに1本足したら、`docs/state-transitions/analysis.md` の ※15 にも枝を足すこと。**
 * `src/__tests__/analysisRefusals.test.ts` が突き合わせる。
 *
 * @packageDocumentation
 */

/**
 * 断りではなく、**複数の断りが末尾に埋め込む部品**。
 * 起こし直し方の出典は `docs/state-transitions/engine.md` の ※5。
 *
 * **外へ出さない。** 読み手はこのファイルの中の断りだけで、出すと
 * 「到達しない公開面」として数に乗る（`scripts/knip-ratchet.sh`）。
 */
const RESTART_ENGINE_HINT = "設定でエンジンのオプションを変えて保存すると起こし直せます。";
/** 上限まで待っても同期が追いつかない。**押し直しで直りうる。** */
export const POSITION_SYNC_TIMEOUT_MESSAGE =
  "局面の準備に時間が掛かっています。もう一度 ▶ を押してください。";
/** Rust が開始を断った（席が残っている。→ `docs/state-transitions/analysis.md` の ※11 / #172）。 */
export const START_REFUSED_MESSAGE = `解析を開始できませんでした。${RESTART_ENGINE_HINT}`;
/** エンジンの初期化が落ちている（→ F-9 / #171）。 */
export const ENGINE_FAILED_MESSAGE = `エンジンを起動できていません。${RESTART_ENGINE_HINT}`;
/** エンジンをまだ選んでいない。 */
export const NO_ENGINE_SELECTED_MESSAGE =
  "エンジンが起動していません。設定でエンジンを選んでください。";
/** 盤を動かした後の自動再開が落ちた。**▶ で始め直せる**ことがある。 */
export const RESTART_FAILED_MESSAGE = `解析を再開できませんでした。▶ を押しても始まらないときは、${RESTART_ENGINE_HINT}`;

/**
 * 解析結果の購読に失敗した（→ E12 / F-4）。**結果が二度と届かない。**
 * 張り直す口が無い（effect はマウント1回きり）ので、復帰はアプリの起動し直し。
 */
export const LISTENERS_FAILED_MESSAGE = "解析結果を受け取れません。アプリを起動し直してください。";

/**
 * `EngineNotReadyReason` から断りへの対応。**割り当て漏れは tsc が落とす。**
 * `starting` が無いのは断らないため（検討の意思を立てて、戻ったら読み始める）。
 */
export const NOT_READY_REFUSALS: Record<Exclude<EngineNotReadyReason, "starting">, string> = {
  "no-engine": NO_ENGINE_SELECTED_MESSAGE,
  failed: ENGINE_FAILED_MESSAGE,
  cancelled: ENGINE_FAILED_MESSAGE,
};
