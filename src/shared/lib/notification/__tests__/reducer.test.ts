import { describe, expect, it } from "vitest";
import {
  INITIAL_NOTIFICATION_STATE,
  notificationReducer,
  type NotificationState,
} from "../reducer";
import type { NotifyAction, NotifyRequest, VisibleTier } from "../types";

/**
 * 差し替えられるのは見せ方に依らない欄だけ。`presentation` を差し替え可能にすると、
 * spread の結果が union のどの枝にも決まらず、型が制約を語らなくなる
 */
type Over = {
  tier?: VisibleTier;
  title?: string;
  body?: string;
  actions?: NotifyAction[];
  dedupeKey?: string;
};

function request(over: Over = {}): NotifyRequest {
  return {
    tier: "warning",
    presentation: "toast",
    title: "保存できませんでした",
    ...over,
  };
}

function notify(state: NotificationState, over: Over = {}): NotificationState {
  return notificationReducer(state, { type: "notify", request: request(over) });
}

describe("通知の置き場", () => {
  it("出したものが並びに積まれる", () => {
    const state = notify(INITIAL_NOTIFICATION_STATE);

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      tier: "warning",
      presentation: "toast",
      title: "保存できませんでした",
      count: 1,
      autoDismiss: false,
      actions: [],
    });
  });

  // 出さないと決めた段が「出ない」ことは、この検査でしか固定できない。
  // 段の判定を落としても、他のどの検査も赤くならない。
  //
  // **可視の通知から `tier` だけを差し替えては書けない。** 型が別の枝なので、
  // 見せ方も文言も落として「なぜ出さないか」を書くことになる
  it("silent は何も積まない", () => {
    const state = notificationReducer(INITIAL_NOTIFICATION_STATE, {
      type: "notify",
      request: { tier: "silent", reason: "cancelSearch は no-op として通るのが仕様" },
    });

    expect(state).toBe(INITIAL_NOTIFICATION_STATE);
  });

  it("id は出した順に増える", () => {
    const state = notify(notify(INITIAL_NOTIFICATION_STATE));

    expect(state.notifications.map((n) => n.id)).toEqual(["notice-1", "notice-2"]);
  });

  it("鍵が無ければ同じ内容でも別々に積む", () => {
    const state = notify(notify(INITIAL_NOTIFICATION_STATE));

    expect(state.notifications).toHaveLength(2);
  });

  describe("同じ鍵は畳む", () => {
    const folded = notify(
      notify(INITIAL_NOTIFICATION_STATE, { dedupeKey: "sfen", title: "1件目" }),
      { dedupeKey: "sfen", title: "2件目", body: "74 手目" },
    );

    it("1つのまま件数が増える", () => {
      expect(folded.notifications).toHaveLength(1);
      expect(folded.notifications[0].count).toBe(2);
    });

    // 最初のものを残すと、増え続けている間ずっと古い情報を見せる
    it("本文は最後に来たもので置き換わる", () => {
      expect(folded.notifications[0].title).toBe("2件目");
      expect(folded.notifications[0].body).toBe("74 手目");
    });

    it("id は動かない", () => {
      expect(folded.notifications[0].id).toBe("notice-1");
    });

    // 畳んだのに採番を進めると、どの通知も名乗らない id が飛び番で残る
    it("畳んだときは採番しない", () => {
      expect(folded.nextSeq).toBe(2);
    });

    // 件数だけ増えて段が据え置かれると、「読めなかった」が
    // 「もう続けられない」に変わったことが黙って消える
    it("段が上がったら上書きする", () => {
      const raised = notificationReducer(folded, {
        type: "notify",
        request: request({ dedupeKey: "sfen", tier: "danger" }),
      });

      expect(raised.notifications[0].tier).toBe("danger");
      expect(raised.notifications[0].count).toBe(3);
    });

    /**
     * 復帰手段を持つ通知に、動作を書かない別の経路から同じ鍵で通知が来ると、
     * 表示は残ったままボタンだけ消えて件数が増える。利用者は復帰手段の無い
     * エラー表示の前に取り残される。
     */
    describe("動作", () => {
      const retry = { label: "再試行", run: () => {} };
      const withActions = notify(INITIAL_NOTIFICATION_STATE, {
        dedupeKey: "analysis",
        actions: [retry],
      });

      it("書かれていなければ残す", () => {
        const state = notify(withActions, { dedupeKey: "analysis" });

        expect(state.notifications[0].actions).toEqual([retry]);
        expect(state.notifications[0].count).toBe(2);
      });

      it("書かれていれば差し替える", () => {
        const restart = { label: "エンジンを再起動", run: () => {} };
        const state = notify(withActions, { dedupeKey: "analysis", actions: [restart] });

        expect(state.notifications[0].actions).toEqual([restart]);
      });

      // 「書いていない」と「空で書いた」を区別する。消す手段が無いと、
      // 直った後もボタンが残り続ける
      it("空で書けば消える", () => {
        const state = notify(withActions, { dedupeKey: "analysis", actions: [] });

        expect(state.notifications[0].actions).toEqual([]);
      });
    });

    it("鍵が違えば畳まない", () => {
      const other = notificationReducer(folded, {
        type: "notify",
        request: request({ dedupeKey: "other" }),
      });

      expect(other.notifications).toHaveLength(2);
    });
  });

  describe("消す", () => {
    const two = notify(notify(INITIAL_NOTIFICATION_STATE, { dedupeKey: "engine" }));

    it("id で消える", () => {
      const state = notificationReducer(two, { type: "dismiss", id: "notice-1" });

      expect(state.notifications.map((n) => n.id)).toEqual(["notice-2"]);
    });

    it("鍵で消える", () => {
      const state = notificationReducer(two, { type: "dismissByKey", key: "engine" });

      expect(state.notifications.map((n) => n.id)).toEqual(["notice-2"]);
    });

    // 条件が満たされている間ずっと撃たれうるので、空振りで再描画を起こさない
    it("知らない id では同じ参照が返る", () => {
      expect(notificationReducer(two, { type: "dismiss", id: "notice-9" })).toBe(two);
    });

    it("知らない鍵では同じ参照が返る", () => {
      expect(notificationReducer(two, { type: "dismissByKey", key: "none" })).toBe(two);
    });
  });

  it("元の状態を書き換えない", () => {
    const before = notify(INITIAL_NOTIFICATION_STATE);
    const snapshot = before.notifications[0];

    notificationReducer(before, { type: "notify", request: request({ dedupeKey: "x" }) });
    notificationReducer(before, { type: "dismiss", id: "notice-1" });

    expect(before.notifications).toHaveLength(1);
    expect(before.notifications[0]).toBe(snapshot);
  });
});
