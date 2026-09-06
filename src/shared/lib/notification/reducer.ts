import type { Notification, NotificationId, NotifyRequest, VisibleTier } from "./types";

export type NotificationState = {
  notifications: Notification[];
  /**
   * 次に配る id の番号。**状態に持つ**ので、reducer は入力だけで結果が決まる。
   * provider 側の ref で採ると、同じ tick に2回出したときの結果が
   * React のバッチの都合で変わる
   */
  nextSeq: number;
};

export type NotificationAction =
  | { type: "notify"; request: NotifyRequest }
  | { type: "dismiss"; id: NotificationId }
  | { type: "dismissByKey"; key: string };

export const INITIAL_NOTIFICATION_STATE: NotificationState = {
  notifications: [],
  nextSeq: 1,
};

function toNotification(request: NotifyRequest, tier: VisibleTier, seq: number): Notification {
  return {
    id: `notice-${seq}`,
    tier,
    presentation: request.presentation,
    title: request.title,
    body: request.body,
    actions: request.actions ?? [],
    autoDismiss: request.autoDismiss ?? false,
    dedupeKey: request.dedupeKey,
    count: 1,
  };
}

/**
 * 同じ `dedupeKey` の通知は積まずに畳む。
 *
 * **本文は最後に来たもので置き換える。** 最初のものを残すと、増え続けている間
 * ずっと古い情報を見せることになる（「74手目で読めなかった」が1件目のまま止まる）。
 *
 * **id と並び順は動かさない。** 動かすと、畳まれるたびに通知が右下で跳ね、
 * 読んでいる途中の別の通知がずれる。
 */
function foldInto(existing: Notification, request: NotifyRequest, tier: VisibleTier): Notification {
  return {
    ...existing,
    // 段も上書きする。同じ鍵で段が上がる経路（「読めなかった」が
    // 「もう続けられない」に変わる）を、件数だけ増やして黙らせない
    tier,
    presentation: request.presentation,
    title: request.title,
    body: request.body,
    actions: request.actions ?? [],
    autoDismiss: request.autoDismiss ?? false,
    count: existing.count + 1,
  };
}

export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "notify": {
      const { request } = action;
      const tier = request.tier;
      // 出さないと決めた段。握り潰しとの違いは、ここに来ていること自体が示す
      if (tier === "silent") return state;

      const key = request.dedupeKey;
      const at = key === undefined ? -1 : state.notifications.findIndex((n) => n.dedupeKey === key);
      if (at >= 0) {
        const notifications = [...state.notifications];
        notifications[at] = foldInto(notifications[at], request, tier);
        // 畳んだので採番しない。進めると、存在しない id の飛び番だけが残る
        return { ...state, notifications };
      }

      return {
        notifications: [...state.notifications, toNotification(request, tier, state.nextSeq)],
        nextSeq: state.nextSeq + 1,
      };
    }

    case "dismiss":
      return withoutMatching(state, (n) => n.id === action.id);

    case "dismissByKey":
      return withoutMatching(state, (n) => n.dedupeKey === action.key);
  }
}

/**
 * 消えるものが無ければ**同じ参照を返す**。知らない id や鍵で消しに来たときに
 * 再描画を起こさないため。通知を条件と結び付けて出し消しする側（バナー）は、
 * 条件が満たされている間ずっと `dismissByKey` を撃ちうる
 */
function withoutMatching(
  state: NotificationState,
  matches: (n: Notification) => boolean,
): NotificationState {
  const notifications = state.notifications.filter((n) => !matches(n));
  if (notifications.length === state.notifications.length) return state;
  return { ...state, notifications };
}
