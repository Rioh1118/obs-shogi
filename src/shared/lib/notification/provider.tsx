import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { NotificationActionsContext, NotificationListContext } from "./context";
import { INITIAL_NOTIFICATION_STATE, notificationReducer } from "./reducer";
import type { NotificationActions, NotificationId, NotifyRequest } from "./types";

/**
 * 通知が自動で消えるまでの時間。
 *
 * 1つしか置かない。呼び手が選べると、同じ段の通知が画面ごとに違う速さで消える。
 *
 * 6秒は、題1行と本文1行（日本語で40字前後）を読み終える時間から取った。
 * 自動で消えるのは利用者が何もしなくてよい失敗だけで、型が動作を持たせないので、読み落としても操作は失われない。
 */
const AUTO_DISMISS_MS = 6000;

/**
 * 通知の置き場（ADR-0004 決定6）。持つのは「いま何が出ているか」だけで、描かない。
 *
 * 描くのは `NotificationLayer` と、インラインを置く各部品。
 * 各スライスの `state.error` は置き換えない。通知は利用者に伝えるためのもので、状態としてのエラーは別物。
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(notificationReducer, INITIAL_NOTIFICATION_STATE);

  const notify = useCallback((request: NotifyRequest) => {
    dispatch({ type: "notify", request });
  }, []);

  const dismiss = useCallback((id: NotificationId) => {
    dispatch({ type: "dismiss", id });
  }, []);

  const dismissByKey = useCallback((key: string) => {
    dispatch({ type: "dismissByKey", key });
  }, []);

  useAutoDismiss(state.notifications, dismiss);

  // 3つとも `useCallback` で不変なので、この値は mount 後に変わらない。
  // 出す関数だけを購読する部品は、通知が出入りしても再描画しない
  const actions = useMemo<NotificationActions>(
    () => ({ notify, dismiss, dismissByKey }),
    [notify, dismiss, dismissByKey],
  );

  return (
    <NotificationActionsContext.Provider value={actions}>
      <NotificationListContext.Provider value={state.notifications}>
        {children}
      </NotificationListContext.Provider>
    </NotificationActionsContext.Provider>
  );
}

/**
 * 自動で消える通知に時計を張る。
 *
 * 通知ごとに1本の時計を持ち、effect の cleanup で全部を張り直さない。
 * 張り直すと通知が増えるたびに**先に出ていた通知の残り時間が巻き戻り**、失敗が続く間は1件も消えなくなる。
 *
 * 時計の鍵に件数を混ぜるのは、畳まれたら数え直すため。
 * 1件目の時計のまま消えると、最後の1件は出た直後に消える。
 */
function useAutoDismiss(
  notifications: { id: NotificationId; autoDismiss: boolean; count: number }[],
  dismiss: (id: NotificationId) => void,
) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // 時計が切れるのは effect の外。そのときの dismiss を読ませる
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const live = new Set<string>();

    for (const n of notifications) {
      if (!n.autoDismiss) continue;
      const key = `${n.id}:${n.count}`;
      live.add(key);
      if (timers.current.has(key)) continue;
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          dismissRef.current(n.id);
        }, AUTO_DISMISS_MS),
      );
    }

    for (const [key, handle] of timers.current) {
      if (live.has(key)) continue;
      clearTimeout(handle);
      timers.current.delete(key);
    }
  }, [notifications]);

  // 上の effect は残り時間を保つために cleanup を返さないので、unmount で残る時計はここで落とす
  useEffect(() => {
    const handles = timers.current;
    return () => {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
    };
  }, []);
}
