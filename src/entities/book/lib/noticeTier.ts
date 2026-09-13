import type { VisibleTier } from "@/shared/lib/notification/types";
import type { BookErrorCode } from "../model/types";

/**
 * 失敗の段。**段は深刻さではなく「復帰に何が要るか」で切る**（ADR-0004）。
 *
 * - `warning` —— **そのまま再試行すれば直りうる。** 読み書きの失敗と、
 *   閉じられたハンドル（開き直せば同じ操作が通る）
 * - `danger` —— **別の操作が要る。** ファイルが無い・読めない・形式が違う。
 *   どれも「もう一度押す」では直らないので、別の定跡を選ぶところまで案内が要る
 *
 * `fatal` は使わない。定跡が開けないことでアプリを起動し直す必要は無い。
 * `info` も使わない —— **失敗はどれも、利用者が何かをしないと解けない。**
 */
export function bookNoticeTier(code: BookErrorCode): VisibleTier {
  switch (code) {
    case "io":
    case "invalid_handle":
    case "unknown":
      return "warning";
    default:
      return "danger";
  }
}
