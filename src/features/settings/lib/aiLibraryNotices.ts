import type { NotifyRequest } from "@/shared/lib/notification/types";

/**
 * フォルダを開けなかったことの通知を作る。文面の決まりは `docs/spec/screens/settings.md`。
 *
 * 段と見せ方は ADR-0004 の F-13。次の操作が要るのに `info` に留めるのは、復帰の操作が通知の外にあるため。
 * 「選択…」は常設で、「engines/ を作成」は読み直しで消えていたときに現れる。
 * 鍵にパスを混ぜるのは、別のフォルダの失敗を1枚に畳まないため。
 */
export function revealFailureNotice(label: string, path: string): NotifyRequest {
  return {
    tier: "info",
    presentation: "toast",
    autoDismiss: true,
    title: `${label}を開けませんでした`,
    body: "場所が変わったか、ファイル管理ソフトを呼べていません",
    dedupeKey: `reveal:${path}`,
  };
}

/**
 * AI フォルダを作っている間に AI ルートが変わったときの結果
 *
 * 見せ方は F-13 と同じ toast だが、段と本文を結果で割る。文面の決まりは `docs/spec/screens/settings.md`。
 * 段を揃えると、6秒で消える通知の差が題の末尾の1語だけになる。
 */
type StaleCreateOutcome = "created" | "name-error" | "failed";

const STALE_CREATE_BODY: Record<StaleCreateOutcome, string> = {
  created: "切り替える前の AI ライブラリでの結果です",
  // 名前で落ちた回に「同じ名前で作り直せます」と言うと、欄に残っている赤字と正面から食い違う
  "name-error": "名前を直してから作成し直してください",
  failed: "同じ名前で作成し直せます",
};

/**
 * ルートが変わった後に返った作成の結果の通知を作る。
 *
 * 画面は別のルートを指していて一覧に出ないので、黙ると失敗に見え、押した人は新しいルートにもう1つ作る。
 */
export function staleCreateNotice(
  root: string,
  name: string,
  outcome: StaleCreateOutcome,
): NotifyRequest {
  const created = outcome === "created";
  return {
    tier: created ? "info" : "warning",
    presentation: "toast",
    autoDismiss: true,
    title: created
      ? `前のフォルダに「${name}」を作成しました`
      : `前のフォルダに「${name}」を作成できませんでした`,
    body: STALE_CREATE_BODY[outcome],
    dedupeKey: `create-profile:${root}/${name}`,
  };
}
