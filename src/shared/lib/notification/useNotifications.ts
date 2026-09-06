import { useContext } from "react";
import { NotificationActionsContext, NotificationListContext } from "./context";
import type { NotificationActions, NotificationContextType } from "./types";

/**
 * 通知を出す。**出す側はこちらを使う。**
 *
 * 返るのは mount 後に一度も変わらない値なので、これを読んでいる部品は
 * 通知が出入りしても再描画しない。
 *
 * **provider の外で呼ぶと投げる。** 囲い忘れを黙った no-op にすると、
 * 失敗を出したつもりで何も出ていない状態になる——この基盤が直そうとしている形そのもの。
 *
 * `silent` の段を渡したときは何も起きない（`NotifyRequest`）。
 */
export function useNotify(): NotificationActions {
  const ctx = useContext(NotificationActionsContext);
  if (!ctx) {
    throw new Error("useNotify must be used within NotificationProvider");
  }
  return ctx;
}

/**
 * 出す口と、いま出ているもの。**両方が要るのは通知を描く層だけ。**
 *
 * 出すだけなら `useNotify` を使うこと。こちらは通知が出入りするたびに
 * 呼び出し側を再描画させる。
 */
export function useNotifications(): NotificationContextType {
  const actions = useNotify();
  const notifications = useContext(NotificationListContext);
  if (!notifications) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return { ...actions, notifications };
}
