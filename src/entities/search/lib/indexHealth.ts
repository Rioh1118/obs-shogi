import type { IndexUiState } from "../model/types";
import { isIndexBusy } from "./indexState";

/**
 * 索引のいまの具合。画面はこれで分岐する。
 *
 * 旗を画面ごとに見ると見る順が割れるので、順は `indexHealth` だけが持つ。
 *
 * `SearchSession.stale` は含めない。索引でなく、その検索の間に索引が動いたかを言う値なので、
 * 画面が別に見る。
 */
export type IndexHealth =
  /** 走査が完走していない。索引は最後に読めたときのまま */
  | "notRefreshed"
  /** 走査が完走せず、索引に入れられなかった棋譜もある。繋ぎ直しても差は消えない */
  | "notRefreshedAndPartiallyIndexed"
  /** 作ろうとして作れなかった。索引が無いので、検索は必ず0件 */
  | "buildFailed"
  /** 走査は完走したが、索引に入れられなかった棋譜がある（壊れた KIF など） */
  | "partiallyIndexed"
  /**
   * 一部の場所を読めなかった。
   *
   * その場所の棋譜の扱いはこの値では決まらない。差分更新は前回から引き継ぐので検索に
   * 出続け（追加と変更は反映されない）、全件構築は引き継ぐ前回が無いので索引に入らない。
   * 線の旗は1つなので画面は言い切れず、場所ごとの事実は `EVT_INDEX_WARN` が言う
   * （`announce.rs` の `unreadable_places`）。
   */
  | "partiallyUnreadable"
  /**
   * 読めなかった場所と、索引に入れられなかった棋譜の両方がある。
   *
   * 片方に畳むと、場所の権限を直しても壊れた棋譜は検索に出ないことが分からなくなる。
   */
  | "partiallyUnreadableAndIndexed"
  /** 作成中、更新中。待てば増える */
  | "building"
  /** まだ作っていない。待っても増えない */
  | "notStarted"
  /** 最後の走査は完走している */
  | "ok";

/**
 * 索引の具合を1つに決める。
 *
 * 進行中でなければ、重い側から見る。走査が失敗しているなら、利用者が次にすることは
 * ワークスペースを繋ぎ直す一手で、一部を読めなかったかは問題にならない。
 */
export function indexHealth(index: IndexUiState): IndexHealth {
  // 読めない場所があっても、走っている間は待てば増えるので先に言う
  if (isIndexBusy(index.state)) {
    return "building";
  }
  // 進行中は数が揃っていないのが普通（`IndexStatePayload.indexedFiles` の doc）
  const someNotIndexed = index.state === "Ready" && index.indexedFiles < index.totalFiles;

  // 「更新できていない」と「無い」を分ける。前者は前回の索引で検索が当たり、後者は必ず0件
  if (index.scanFailed) {
    if (index.state === "Empty") return "buildFailed";
    // 走査の失敗で `someNotIndexed` を落とさない。この差は繋ぎ直しても消えない
    return someNotIndexed ? "notRefreshedAndPartiallyIndexed" : "notRefreshed";
  }
  // `Empty` を旗より先に見る。空の索引で「そこの棋譜だけ」と言うと、どの局面も0件になることが
  // 画面から消える。いまの Rust はこの組み合わせを出さない
  if (index.state === "Empty") return "notStarted";

  // 棋譜1件の構築失敗は場所の旗に載らないので、数の差で見る
  if (index.partiallyUnreadable && someNotIndexed) return "partiallyUnreadableAndIndexed";
  if (index.partiallyUnreadable) return "partiallyUnreadable";
  if (someNotIndexed) return "partiallyIndexed";
  return "ok";
}
