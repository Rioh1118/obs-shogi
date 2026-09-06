import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { NotificationActionsContext, NotificationListContext } from "./context";
import { INITIAL_NOTIFICATION_STATE, notificationReducer } from "./reducer";
import type { NotificationActions, NotificationId, NotifyRequest } from "./types";

/**
 * 自動で消えるまで。**1つしか置かない。**
 * 呼び出し側が秒数を選べるようにすると、同じ段の通知が画面ごとに違う速さで消える。
 */
const AUTO_DISMISS_MS = 6000;

/**
 * 通知の置き場（ADR-0004 決定6）。
 *
 * **描かない。** 描くのは `NotificationLayer`（グローバルの3経路）と、
 * インラインを置く各コンポーネント。ここが持つのは「いま何が出ているか」だけ。
 *
 * **各スライスの `state.error` を置き換えるものではない。** 通知は利用者に
 * 伝えるためのもので、状態としてのエラーは別物（ADR-0004 決定6）。
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

  // **依存が空。** 3つとも `useCallback` で不変なので、この値は mount 後に
  // 一度も変わらない。出す口だけを購読する部品は通知が出入りしても再描画しない
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
 * 自動で消えるものに時計を持たせる。
 *
 * **1つの effect で全部の時計を張り直さない。** 通知が1つ増えるたびに
 * cleanup が走るので、張り直すと**先に出ていた通知の残り時間が毎回巻き戻る**。
 * 失敗が続けて出ている間は1件も消えなくなる。
 *
 * 鍵に件数を混ぜるのは逆で、**畳まれたら数え直したい**ため。同じ失敗がまた
 * 起きているのに、1件目の時計のまま消えると、最後の1件は出た直後に消える。
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

  // 張った時計は自分で畳む。**上の effect は cleanup を返していない**ので
  // （返すと通知が1つ増えるたびに全部が張り直され、残り時間が巻き戻る）、
  // unmount で残る時計を落とす場所がここしか無い
  useEffect(() => {
    const handles = timers.current;
    return () => {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
    };
  }, []);
}
