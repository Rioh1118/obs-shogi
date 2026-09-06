import { createContext } from "react";
import type { Notification, NotificationActions } from "./types";

/**
 * **出す口と、出ているものを別の context に置く。**
 *
 * 1つにすると、`notify` しか使わない部品まで通知が出入りするたびに再描画する。
 * 出す側はアプリ中に散る（ADR-0004 の割り当ては19件ある）のに、
 * 出ているものを読むのは通知の層1つだけなので、束ねる理由が無い。
 *
 * 動作の3つは `useCallback` で不変なので、こちらの値は mount 後に一度も変わらない。
 */
export const NotificationActionsContext = createContext<NotificationActions | undefined>(undefined);

/** 出ているもの。購読するのは `NotificationLayer` だけ */
export const NotificationListContext = createContext<Notification[] | undefined>(undefined);
