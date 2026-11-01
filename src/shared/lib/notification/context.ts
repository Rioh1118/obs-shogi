import { createContext } from "react";
import type { Notification, NotificationActions } from "./types";

/**
 * 通知を出す関数の context。出ているものとは別の context に置く。
 *
 * 1つにすると、`notify` しか使わない部品まで通知が出入りするたびに再描画する。
 * 出す側はアプリ中に散り、出ているものを読むのは通知の層だけなので、束ねる理由が無い。
 *
 * 動作の3つは `useCallback` で不変なので、この値は mount 後に変わらない。
 */
export const NotificationActionsContext = createContext<NotificationActions | undefined>(undefined);

/**
 * 出ている通知の context。購読するのは `NotificationLayer` だけ。
 *
 * どちらの context も `useContext` で直に読まず、`useNotify`（出す側）と `useNotifications`（描く側）を通す。
 * 素で読むと囲い忘れが `undefined` として通り、通知を出したつもりで何も出ない。
 */
export const NotificationListContext = createContext<Notification[] | undefined>(undefined);
