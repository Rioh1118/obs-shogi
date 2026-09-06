import type { IndexUiState } from "../model/types";

/**
 * 索引がいまどういう具合か。**画面はこれで分岐する。**
 *
 * `scanFailed` と `partiallyUnreadable` と `state` を画面ごとに手で並べると、
 * 見る順が割れる。順はここ1つが持つ。
 *
 * **セッション由来の `stale` はここに入らない。** あれは索引ではなく
 * 「この検索が走っている間に索引が動いたか」なので、画面が別に見る。
 */
export type IndexHealth =
  /** 走査が完走していない。索引は最後に読めたときのまま */
  | "notRefreshed"
  /** 一部の場所を読めなかった。**索引に入っていない棋譜がある** */
  | "partiallyUnreadable"
  /** 作成中・更新中。**待てば増える** */
  | "building"
  /** まだ作っていない。**待っても増えない** */
  | "notStarted"
  /** 最後の走査は完走している */
  | "ok";

/**
 * 索引の具合を1つに決める。
 *
 * **重い側から見る。** 走査そのものが失敗しているなら、一部を読めなかったかは
 * もう問題ではない——利用者が次にすることは「ワークスペースを繋ぎ直す」の一手。
 */
export function indexHealth(index: IndexUiState): IndexHealth {
  // **走っている最中は、まずそう言う。** 読めない場所があっても、その間は
  // 「待てば増える」が先。ここを後ろにすると、構築中ずっと警告三角の
  // 「一部を読めていません」で止まり、**利用者は待てば直るものを直しに行く**
  if (index.state === "Restoring" || index.state === "Building" || index.state === "Updating") {
    return "building";
  }
  if (index.scanFailed) return "notRefreshed";
  if (index.partiallyUnreadable) return "partiallyUnreadable";
  // **`Empty` を「作成中」と言わない。** 何も走っていないので待っても増えない
  if (index.state === "Empty") return "notStarted";
  return "ok";
}
