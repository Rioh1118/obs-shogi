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
    dismissKey: request.dismissKey,
    count: 1,
  };
}

/**
 * 同じ `dedupeKey` の通知を積まずに畳む。
 *
 * 本文は最後に来たもので置き換える。最初のものを残すと、増え続ける間ずっと古い情報を見せる。
 *
 * id と並び順は動かさない。動かすと畳まれるたびに通知が跳ね、読んでいる別の通知がずれる。
 *
 * **動作だけは上書きしない。** 動作を書かない別の経路から同じ鍵で通知が来ると、ボタンだけが消え、
 * 利用者は復帰手段の無い表示の前に取り残される。消したいときは `actions: []` を明示する。
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
 * 同じ `dismissKey` で来た通知で置き換える。
 *
 * id と並び順は `foldInto` と同じく動かさない。件数は数えない。
 * この鍵は条件と結び付いた通知が持つもので、2件目は「また起きた」ではなく「まだ続いている」。
 * 数を出す条件は `dedupeKey` が持つ（`Notification.count`、`NotificationLayer`）。
 */
function replaceHeld(
  existing: Notification,
  request: VisibleRequest,
  tier: VisibleTier,
): Notification {
  return { ...toNotification(request, tier, 0), id: existing.id };
}

/**
 * 通知の置き場の状態遷移。
 *
 * - `silent` の段は何も積まない（ADR-0004 決定2）
 * - 同じ `dedupeKey` は畳む。件数だけが増え、id と並び順は動かず、採番も進まない
 * - 同じ `dismissKey` は置き換える。件数は増えず、id と並び順は動かない。両方あれば畳みが勝つ
 * - 消えるものが無い `dismiss` と `dismissByKey` は同じ参照を返す
 *
 * `__tests__/reducer.test.ts` がこの4つを固定している。
 */
export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "notify": {
      const { request } = action;
      // `request` を直に見るので、以降は型が見せ方の枝に絞られる
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

      // 同じ `dismissKey` の通知は1枚に保つ。出す側は条件が続く間に出し直すので、積むと同じ通知が並ぶ
      const handle = request.dismissKey;
      const held =
        handle === undefined ? -1 : state.notifications.findIndex((n) => n.dismissKey === handle);
      if (held >= 0) {
        const notifications = [...state.notifications];
        notifications[held] = replaceHeld(notifications[held], request, tier);
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
      return withoutMatching(
        state,
        (n) => n.dedupeKey === action.key || n.dismissKey === action.key,
      );
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
