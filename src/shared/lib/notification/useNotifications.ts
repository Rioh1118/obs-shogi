import { useContext } from "react";
import { NotificationActionsContext, NotificationListContext } from "./context";
import type { NotificationActions, NotificationsView } from "./types";

/**
 * 通知を出す関数を返す。
 *
 * 返す値は mount 後に変わらないので、読んでいる部品は通知が出入りしても再描画しない。
 * `silent` の段を渡したときは何も起きない（`NotifyRequest`）。
 *
 * **provider の外で呼ぶと投げる。** 囲い忘れを黙った no-op にすると、失敗を出したつもりで何も出ない。
 */
export function useNotify(): NotificationActions {
  const ctx = useContext(NotificationActionsContext);
  if (!ctx) {
    throw new Error("useNotify must be used within NotificationProvider");
  }
  return ctx;
}

/**
 * 出す関数と、いま出ているもの。**両方が要るのは通知を描く層だけ。**
 *
 * 出すだけなら `useNotify` を使うこと。こちらは通知が出入りするたびに
 * 呼び出し側を再描画させる。
 */
export function useNotifications(): NotificationsView {
  const actions = useNotify();
  const notifications = useContext(NotificationListContext);
  if (!notifications) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return { ...actions, notifications };
}
