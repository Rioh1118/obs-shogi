import type {
  Notification,
  NotificationId,
  NotifyAction,
  NotifyRequest,
  VisibleTier,
} from "./types";

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

/** 見せ方の枝を持つ要求。`silent` を落としたあとはこれしか来ない */
type VisibleRequest = Exclude<NotifyRequest, { tier: "silent" }>;

/**
 * 自動で消えるのは `toast` の枝だけ。**ここで型から読み切る**ので、
 * 時計を張る側（`useAutoDismiss`）は見せ方を知らなくてよい
 */
function autoDismissOf(request: VisibleRequest): boolean {
  return request.presentation === "toast" && request.autoDismiss === true;
}

/**
 * 書かれた動作。**「書いていない」と「空で書いた」を区別する**ので `undefined` を返しうる。
 * 畳むときにその区別が要る（`foldInto`）
 */
function actionsOf(request: VisibleRequest): NotifyAction[] | undefined {
  return "actions" in request ? request.actions : undefined;
}

function toNotification(request: VisibleRequest, tier: VisibleTier, seq: number): Notification {
  return {
    id: `notice-${seq}`,
    tier,
    presentation: request.presentation,
    title: request.title,
    body: request.body,
    actions: actionsOf(request) ?? [],
    autoDismiss: autoDismissOf(request),
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
 *
 * **動作だけは上書きしない。** 復帰手段を持つ通知に、動作を書かない別の経路から
 * 同じ鍵で通知が来ると、表示は残ったままボタンだけ消えて件数が増える——
 * 利用者は復帰手段の無いエラー表示の前に取り残される。
 * 消したいときは `actions: []` を明示する。
 */
function foldInto(
  existing: Notification,
  request: VisibleRequest,
  tier: VisibleTier,
): Notification {
  return {
    ...existing,
    // 段も上書きする。同じ鍵で段が上がる経路（「読めなかった」が
    // 「もう続けられない」に変わる）を、件数だけ増やして黙らせない
    tier,
    presentation: request.presentation,
    title: request.title,
    body: request.body,
    actions: actionsOf(request) ?? existing.actions,
    autoDismiss: autoDismissOf(request),
    count: existing.count + 1,
  };
}

/**
 * 通知の置き場の状態遷移。**呼び出し規約は3つ。**
 *
 * - `silent` の段は何も積まない（ADR-0004 決定2）
 * - 同じ `dedupeKey` は畳む。件数だけが増え、id と並び順は動かず、採番も進まない
 * - 消えるものが無い `dismiss` / `dismissByKey` は**同じ参照を返す**
 *
 * どれも「呼んだのに何も起きない」形なので、外から見て区別が付かない。
 * 変えるときは `__tests__/reducer.test.ts` が3つとも固定していることを確かめること。
 */
export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "notify": {
      const { request } = action;
      // 出さないと決めた段。握り潰しとの違いは、ここに来ていること自体が示す。
      // **`request` を直に見る**ので、以降は型が見せ方の枝に絞られる
      if (request.tier === "silent") return state;
      const tier = request.tier;

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
