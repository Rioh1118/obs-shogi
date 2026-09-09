import type { VisibleTier } from "@/shared/lib/notification/types";
import type { KifuLoadFailure } from "../model/types";

/**
 * 盤に載せられなかった失敗の**段**と**何が起きたか**を、`code` から決める。
 *
 * **呼び出し側に決めさせない。** 段と文言を呼び出し側が書くと、2件目の呼び手が
 * 別の段を選んでも誰も気づかない。`entities/file-tree` が `fsErrorTier` /
 * `describeFsError` で同じ問題を避けている（`api/error.ts`）。
 *
 * **「何をすれば直るか」はここに書かない。** 復帰の手順はその画面の導線に依るので
 * （ツリーで選び直す、など）、出す側が持つ。ここが持つのは「何が起きたか」まで。
 */

/**
 * 段。**復帰に何が要るか**で切る（ADR-0004 決定1）。
 *
 * どちらも `danger`——**この画面の操作では直らない**。同じ棋譜を開き直しても、
 * ファイルの中身が変わっていなければ同じ結果になる。
 * `warning`（同じ操作をもう一度で直る見込み）にしてはいけない。
 */
export function kifuLoadFailureTier(_failure: KifuLoadFailure): VisibleTier {
  return "danger";
}

/** 何が起きたか。**利用者の言葉で。** 内部の語（`cause`）は出さない */
export function describeKifuLoadFailure(failure: KifuLoadFailure): string {
  switch (failure.code) {
    case "unplayable_initial":
      return "このファイルは、いまの中身では盤に並べられません。";
    case "unknown":
      return "このファイルを盤に並べられませんでした。";
  }
}
