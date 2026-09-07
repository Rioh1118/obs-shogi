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
  /** 走査も完走せず、索引に入れられなかった棋譜もある。**繋ぎ直しても差は消えない** */
  | "notRefreshedAndPartiallyIndexed"
  /** 作ろうとして作れなかった。**索引が無い**ので、検索は必ず0件 */
  | "buildFailed"
  /** 走査は完走したが、**索引に入れられなかった棋譜がある**（壊れた KIF など） */
  | "partiallyIndexed"
  /**
   * 一部の場所を読めなかった。
   *
   * **その場所の棋譜がどうなったかは、この旗だけでは決まらない。** 差分更新は
   * 前回の走査から引き継ぐので検索に出続ける（ただし追加・変更は反映されない）が、
   * 全件構築には引き継ぐ前回が無いので索引に入らない。**線に出る旗は1つしか
   * 無いので、画面はどちらとも言い切れない**——場所ごとの本当のことは
   * `EVT_INDEX_WARN` が言う（`announce::unreadable_places`）。
   */
  | "partiallyUnreadable"
  /**
   * 読めなかった場所と、索引に入れられなかった棋譜の**両方**がある。
   *
   * 片方に畳むと、利用者は差の全部をもう片方のせいだと読む——場所の権限を
   * 直しても、壊れた棋譜は検索に出ないまま。
   */
  | "partiallyUnreadableAndIndexed"
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
  // 差を読むのは `Ready` の回だけ。進行中は数が揃っていないのが当たり前
  // （`IndexStatePayload.indexedFiles` の doc）
  const someNotIndexed = index.state === "Ready" && index.indexedFiles < index.totalFiles;

  // **「更新できていない」と「そもそも無い」を同じ語にしない。**
  // 前者は前回の索引が残っているので検索は当たるが、後者は必ず0件。
  // 畳むと、0件を「自分の棋譜に無い」と読ませる
  if (index.scanFailed) {
    if (index.state === "Empty") return "buildFailed";
    // **走査の失敗が「入れられなかった棋譜」を飲み込まない。** あちらは走査由来、
    // こちらは索引由来で、走査の成否と独立に生き残る。畳むと利用者は差を
    // 「更新できていないから」と読み、**繋ぎ直しても消えない差**の説明を失う
    return someNotIndexed ? "notRefreshedAndPartiallyIndexed" : "notRefreshed";
  }
  // **入れ終えた数が対象より少ない回を緑にしない。** `partiallyUnreadable` は
  // 走査＝**場所**の話なので、棋譜1件ごとの構築失敗（壊れた KIF、読めない
  // 文字コード）はここに落ちる。緑を出すと、その棋譜の局面を検索した利用者は
  // 0件を「自分の棋譜に無い」と読む
  //
  // **`Empty` を旗より先に見る。** 索引が空なら検索は必ず0件で、
  // 「そこの棋譜だけ」と言うと**どの局面も0件になること**が画面から消える。
  // いまの Rust はこの組み合わせを出さないが、腕の順は型では守れない
  if (index.state === "Empty") return "notStarted";

  // **どちらかに畳まない。** 畳むと、利用者は差の全部をもう片方のせいだと読む
  // ——場所の権限を直しても、壊れた棋譜は検索に出ないまま
  if (index.partiallyUnreadable && someNotIndexed) return "partiallyUnreadableAndIndexed";
  if (index.partiallyUnreadable) return "partiallyUnreadable";
  if (someNotIndexed) return "partiallyIndexed";
  return "ok";
}
