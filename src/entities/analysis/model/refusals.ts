import type { EngineNotReadyReason, TerminalNotReadyReason } from "@/entities/engine";

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
 */
export const RESTART_ENGINE_HINT = "設定でエンジンのオプションを変えて保存すると起こし直せます。";
/** 上限まで待っても同期が追いつかない。**押し直しで直りうる。** */
export const POSITION_SYNC_TIMEOUT_MESSAGE =
  "エンジンが局面を受け取るのに時間が掛かっています。もう一度 ▶ を押してください。";
/** 局面の送信そのものが落ちた。**押し直しても同じところで落ちる。** */
export const POSITION_SYNC_FAILED_MESSAGE = `エンジンに局面を送れませんでした。${RESTART_ENGINE_HINT}`;
/**
 * ▶ の先頭で、握っている席を返せなかった（→ `docs/state-transitions/analysis.md` の ※2 /
 * `docs/state-transitions/failure-surfacing.md` の F-7）。
 *
 * **まず押し直し。** 停止の invoke が一時的に落ちただけの回は、もう一度 ▶ を押すと
 * 同じ席へ撃ち直して戻る（`provider.test.tsx` が固定している）。
 */
export const RELEASE_FAILED_MESSAGE = `前の解析を止められませんでした。もう一度 ▶ を押してください。それでも始まらないときは、${RESTART_ENGINE_HINT}`;
/** Rust が開始を断った（席が残っている。→ `docs/state-transitions/analysis.md` の ※11 / #172）。 */
export const START_REFUSED_MESSAGE = `解析を開始できませんでした。${RESTART_ENGINE_HINT}`;
/**
 * 席を取りに行っている間にエンジンが起こし直された（→ `docs/state-transitions/analysis.md` の ※13 /
 * `docs/state-transitions/failure-surfacing.md` の F-6）。
 *
 * **起こし直しを頼んだのは利用者自身**（オプションを変えて保存した）なので、
 * 起こし直し方は案内しない。着地した時点でエンジンは戻っていることがあり、
 * その回は押し直すだけで始まる。
 */
export const ENGINE_RESTARTED_MESSAGE =
  "エンジンを起こし直したので、解析を始められませんでした。もう一度 ▶ を押してください。";
/**
 * ■ が届かなかった（→ `docs/state-transitions/analysis.md` の ※7 / F-7）。**表示は停止中になるので、成功と見分けが付かない。**
 * エンジンは閉じた探索を回し続けるので、断りが無いと利用者は気づけない。
 */
export const STOP_FAILED_MESSAGE =
  "解析を止められませんでした。エンジンはまだ読み続けているかもしれません。もう一度 ▶ を押すと、同じ席を止め直してから始めます。";
/**
 * エンジンがまだ起動していない（→ F-9）。**▶ は押せてしまう**（`AnalysisPaneHeader` は
 * エンジンの状態を1つも読まない）ので、起動を待っている間に押した人が必ずここへ来る。
 * **理由ごとに割る**——「選んでください」を起動中の人に言わないため。
 * 理由を決めるのは `entities/engine`（`EngineNotReadyReason`）。
 */
export const ENGINE_STARTING_ON_START_MESSAGE =
  "エンジンの起動を待っています。少し待ってからもう一度 ▶ を押してください。";
/**
 * エンジンの初期化が落ちている（→ F-9 / #171）。**▶ を押した人に出す。**
 * 解析が走っている最中に落ちた回は `ENGINE_FAILED_WHILE_ANALYZING_MESSAGE`。
 */
export const ENGINE_FAILED_ON_START_MESSAGE = `エンジンを起動できていません。${RESTART_ENGINE_HINT}`;
/**
 * 解析の最中に初期化が落ちた（→ `docs/state-transitions/analysis.md` の ※5）。
 *
 * **▶ を押した人への断りと分ける。** あちらは「まだ起動していない」と告げる文で、
 * 押していない人が読むと「押しても始まらない」と受け取る。ここで告げるのは
 * **走っていた解析が切れた**こと。次の一手は同じでも、起きた事が違う。
 */
export const ENGINE_FAILED_WHILE_ANALYZING_MESSAGE = `解析中にエンジンが使えなくなったため、解析を止めました。${RESTART_ENGINE_HINT}`;
/**
 * 解析の最中に `no-engine` になった（→ `docs/state-transitions/analysis.md` の ※5）。
 *
 * **「選んでください」だけで終えない。** 入口は選択が外れた回だけではないので
 * （`EngineNotReadyReason` の doc）、選び直しだけを案内すると、既に選んでいる人が
 * 何度やっても同じ文に戻る。
 */
export const NO_ENGINE_WHILE_ANALYZING_MESSAGE =
  "解析中にエンジンが使えなくなったため、解析を止めました。設定でエンジンを選び、AI フォルダとエンジン・評価関数の場所を確かめてください。";
/** `no-engine` で ▶ を押した（入口は `EngineNotReadyReason` の doc）。 */
export const NO_ENGINE_ON_START_MESSAGE =
  "エンジンが起動していません。設定でエンジンを選び、AI フォルダとエンジン・評価関数の場所を確かめてください。";
/** Rust がエラー通知を送ってきた（→ E9。いま `emit` する口は無い）。 */
export const ENGINE_ERROR_MESSAGE = `エンジンがエラーを返しました。${RESTART_ENGINE_HINT}`;
/** 盤を動かした後の自動再開が落ちた。**▶ で始め直せる**ことがある。 */
export const RESTART_FAILED_MESSAGE = `解析を再開できませんでした。▶ を押しても始まらないときは、${RESTART_ENGINE_HINT}`;

/**
 * 解析結果の購読に失敗した（→ E12 / F-4）。**結果が二度と届かない。**
 * 張り直す口が無い（effect はマウント1回きり）ので、復帰はアプリの起動し直し。
 */
export const LISTENERS_FAILED_MESSAGE = "解析結果を受け取れません。アプリを起動し直してください。";

/** `EngineNotReadyReason` から断りへの対応。**割り当て漏れは tsc が落とす。** */
export const ON_START_REFUSALS: Record<EngineNotReadyReason, string> = {
  "no-engine": NO_ENGINE_ON_START_MESSAGE,
  starting: ENGINE_STARTING_ON_START_MESSAGE,
  failed: ENGINE_FAILED_ON_START_MESSAGE,
};

/**
 * 走っている解析の最中にエンジンが**戻らなくなった**ときの断り。
 *
 * **鍵は終端の理由だけ**（`TerminalNotReadyReason`）。待てば戻る理由をここに書こうとすると
 * tsc が落とすので、「断つ理由」の集合を写す必要が無い——**どれが戻るかを決めるのは
 * engine 側**（`isRecoverableNotReady`。判断の全体は `docs/state-transitions/engine.md` の ※7）。
 * 理由が1つ増えれば、engine で分類した結果としてこの表の過不足を tsc が指摘する。
 */
export const WHILE_ANALYZING_REFUSALS: Record<TerminalNotReadyReason, string> = {
  "no-engine": NO_ENGINE_WHILE_ANALYZING_MESSAGE,
  failed: ENGINE_FAILED_WHILE_ANALYZING_MESSAGE,
};
