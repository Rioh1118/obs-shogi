import type { VisibleTier } from "@/shared/lib/notification/types";
import type { BookErrorCode } from "../model/types";

/**
 * 失敗の段。**段は深刻さではなく「復帰に何が要るか」で切る**（ADR-0004）。
 *
 * - `warning` —— **そのまま再試行すれば直りうる。** 読み書きの失敗だけ
 * - `danger` —— **別の操作が要る。** ファイルが無い・読めない・形式が違う。
 *   どれも「もう一度押す」では直らないので、別の定跡を選ぶところまで案内が要る
 *
 * **閉じられたハンドル（`invalid_handle`）は `danger`。** 「開き直す」は別の操作で、
 * 同じ操作を繰り返しても永久に直らない。`BookProvider` はこれを受けると
 * 定跡を閉じた扱いにするので、画面は開き直す一覧へ戻る。
 *
 * `fatal` は使わない。定跡が開けないことでアプリを起動し直す必要は無い。
 * `info` も使わない —— **失敗はどれも、利用者が何かをしないと解けない。**
 */
export function bookNoticeTier(code: BookErrorCode): VisibleTier {
  switch (code) {
    case "io":
    case "unknown":
      return "warning";
    default:
      return "danger";
  }
}
