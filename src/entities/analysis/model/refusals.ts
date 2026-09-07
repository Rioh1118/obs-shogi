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
 */
export const RESTART_ENGINE_HINT = "設定でエンジンのオプションを変えて保存すると起こし直せます。";
/** 上限まで待っても同期が追いつかない。**押し直しで直りうる。** */
export const POSITION_SYNC_TIMEOUT_MESSAGE =
  "エンジンが局面を受け取るのに時間が掛かっています。もう一度 ▶ を押してください。";
/** 局面の送信そのものが落ちた。**押し直しても同じところで落ちる。** */
export const POSITION_SYNC_FAILED_MESSAGE = `エンジンに局面を送れませんでした。${RESTART_ENGINE_HINT}`;
/**
 * 握っている席を返せなかった（→ ※7 / F-7）。
 *
 * **まず押し直し。** 停止の invoke が一時的に落ちただけの回は、もう一度 ▶ を押すと
 * 同じ席へ撃ち直して戻る（`provider.test.tsx` が固定している）。
 */
export const RELEASE_FAILED_MESSAGE = `前の解析を止められませんでした。もう一度 ▶ を押してください。それでも始まらないときは、${RESTART_ENGINE_HINT}`;
/** Rust が開始を断った（席が残っている。→ ※11 / #172）。 */
export const START_REFUSED_MESSAGE = `解析を開始できませんでした。${RESTART_ENGINE_HINT}`;
/**
 * ■ が届かなかった（→ ※7 / F-7）。**表示は停止中になるので、成功と見分けが付かない。**
 * エンジンは閉じた探索を回し続けるので、断りが無いと利用者は気づけない。
 */
export const STOP_FAILED_MESSAGE =
  "解析を止められませんでした。エンジンはまだ読み続けているかもしれません。もう一度 ▶ を押すと、同じ席を止め直してから始めます。";
/**
 * エンジンがまだ起動していない（→ F-9）。**▶ は押せてしまう**（`AnalysisPaneHeader` は
 * エンジンの状態を1つも読まない）ので、起動を待っている間に押した人が必ずここへ来る。
 * `isReady` は3つの状態（選んでいない／起動中／失敗した）を1つの bool に潰しているので、
 * **どれかで断りを割る**——「選んでください」を起動中の人に言わないため。
 */
export const ENGINE_STARTING_MESSAGE =
  "エンジンの起動を待っています。少し待ってからもう一度 ▶ を押してください。";
/** エンジンの初期化が落ちている（→ F-9 / #171）。 */
export const ENGINE_FAILED_MESSAGE = `エンジンを起動できていません。${RESTART_ENGINE_HINT}`;
/** エンジンを選んでいない、または設定が変わって起動し直しが要る。 */
export const ENGINE_NOT_READY_MESSAGE =
  "エンジンが起動していません。設定でエンジンを選んでください。";
/** Rust がエラー通知を送ってきた（→ E9。いま `emit` する口は無い）。 */
export const ENGINE_ERROR_MESSAGE = `エンジンがエラーを返しました。${RESTART_ENGINE_HINT}`;
/** 盤を動かした後の自動再開が落ちた。**▶ で始め直せる**ことがある。 */
export const RESTART_FAILED_MESSAGE = `解析を再開できませんでした。▶ を押しても始まらないときは、${RESTART_ENGINE_HINT}`;
