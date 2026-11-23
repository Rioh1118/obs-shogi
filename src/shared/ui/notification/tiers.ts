import { CircleAlert, Info, OctagonX, TriangleAlert } from "lucide-react";
import type { VisibleTier } from "@/shared/lib/notification/types";

export const TIER_ICONS: Record<VisibleTier, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  fatal: OctagonX,
};

/**
 * 支援技術に割り込ませるか。
 *
 * `danger` と `fatal` は繰り返しでは直らないので、いま読んでいるものを
 * 中断してでも伝える。`info` と `warning` は読み終わってからでよい。
 */
export const TIER_ROLES: Record<VisibleTier, "status" | "alert"> = {
  info: "status",
  warning: "status",
  danger: "alert",
  fatal: "alert",
};
