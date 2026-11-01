import type { VisibleTier } from "@/shared/lib/notification/types";
import type { BookFailure } from "../model/context";

/**
 * 失敗の段を返す。段は深刻さでなく、復帰に何が要るかで切る（ADR-0004）。
 *
 * - `warning`: そのまま再試行すれば直りうる。読み書きの失敗と、種別の分からない失敗
 * - `danger`: 別の操作が要る。ファイルが無い、読めない、形式が違うなど
 *
 * 閉じられたハンドル（`invalid_handle`）は `danger`。同じ操作を繰り返しても直らない。
 * 引くのがこれで落ちると、`BookProvider` が定跡を閉じた扱いにして、画面は開き直す一覧へ戻る。
 *
 * `fatal` は使わない。定跡が開けなくてもアプリを起動し直す必要は無い。
 * `info` も使わない。失敗はどれも、利用者が何かをしないと解けない。
 */
export function bookNoticeTier(failure: BookFailure): VisibleTier {
  // ここへ来るのはファイルダイアログを開けなかった場合で、押し直しでは直らない。
  // 残る導線は最近開いた定跡の一覧
  if (failure.origin === "external") return "danger";

  switch (failure.error.code) {
    case "io":
    case "unknown":
      return "warning";
    default:
      return "danger";
  }
}
