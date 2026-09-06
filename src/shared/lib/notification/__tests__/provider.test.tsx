// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider } from "../provider";
import { useNotifications } from "../useNotifications";
import type { NotifyRequest, VisibleTier } from "../types";

/** 出ているものを文字にして見せる小さな読み手。中身は見ず、件数と鍵だけを見る */
function Probe({ onReady }: { onReady: (api: ReturnType<typeof useNotifications>) => void }) {
  const api = useNotifications();
  onReady(api);
  return (
    <ul>
      {api.notifications.map((n) => (
        <li key={n.id} data-testid="notice">
          {n.id}:{n.title}:{n.count}
        </li>
      ))}
    </ul>
  );
}

function setup() {
  let api!: ReturnType<typeof useNotifications>;
  render(
    <NotificationProvider>
      <Probe
        onReady={(next) => {
          api = next;
        }}
      />
    </NotificationProvider>,
  );
  return {
    notify: (request: NotifyRequest) => act(() => api.notify(request)),
    dismissByKey: (key: string) => act(() => api.dismissByKey(key)),
    ids: () => screen.queryAllByTestId("notice").map((el) => el.textContent),
  };
}

/** 消えないトースト。動作を持てる枝 */
const toast = (
  over: { tier?: VisibleTier; title?: string; dedupeKey?: string } = {},
): NotifyRequest => ({
  tier: "info",
  presentation: "toast",
  title: "開けませんでした",
  ...over,
});

/** 自動で消えるトースト。**型として動作を持てない**ので、別の口にしてある */
const timedToast = (over: { title?: string; dedupeKey?: string } = {}): NotifyRequest => ({
  tier: "info",
  presentation: "toast",
  title: "開けませんでした",
  autoDismiss: true,
  ...over,
});

describe("通知の provider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("provider の外で使うと落ちる", () => {
    // 例外の中身は読まない。**囲い忘れが黙って no-op にならない**ことだけを見る
    expect(() => render(<Probe onReady={() => {}} />)).toThrow(/NotificationProvider/);
  });

  it("出したものが読み手に届く", () => {
    const app = setup();
    app.notify(toast());

    expect(app.ids()).toEqual(["notice-1:開けませんでした:1"]);
  });

  it("autoDismiss を付けたものは時間で消える", () => {
    const app = setup();
    app.notify(timedToast());

    act(() => vi.advanceTimersByTime(5999));
    expect(app.ids()).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1));
    expect(app.ids()).toEqual([]);
  });

  it("付けなければ消えない", () => {
    const app = setup();
    app.notify(toast());

    act(() => vi.advanceTimersByTime(60_000));
    expect(app.ids()).toHaveLength(1);
  });

  /**
   * 全部の時計を1つの effect で張り直す実装だと、ここが落ちる。
   * 2件目が出た時点で1件目の残り時間が巻き戻り、5999ms 経っても消えない
   */
  it("あとから別の通知が出ても、先に出た通知の残り時間は巻き戻らない", () => {
    const app = setup();
    app.notify(timedToast());

    act(() => vi.advanceTimersByTime(3000));
    app.notify(timedToast({ title: "2件目" }));

    act(() => vi.advanceTimersByTime(3000));
    expect(app.ids()).toEqual(["notice-2:2件目:1"]);
  });

  /**
   * 逆に、**畳まれたら数え直す**。同じ失敗がまた起きているのに1件目の時計の
   * ままだと、最後に来た1件は出た直後に消える
   */
  it("同じ鍵で畳まれたら残り時間を数え直す", () => {
    const app = setup();
    app.notify(timedToast({ dedupeKey: "sfen" }));

    act(() => vi.advanceTimersByTime(5000));
    app.notify(timedToast({ dedupeKey: "sfen", title: "2件目" }));

    act(() => vi.advanceTimersByTime(5000));
    expect(app.ids()).toEqual(["notice-1:2件目:2"]);

    act(() => vi.advanceTimersByTime(1000));
    expect(app.ids()).toEqual([]);
  });

  it("鍵で引っ込められる", () => {
    const app = setup();
    app.notify({
      tier: "warning",
      presentation: "banner",
      title: "開けませんでした",
      dedupeKey: "engine",
    });
    app.dismissByKey("engine");

    expect(app.ids()).toEqual([]);
  });

  it("silent は何も出さない", () => {
    const app = setup();
    app.notify({ tier: "silent", reason: "cancelSearch は no-op として通るのが仕様" });

    expect(app.ids()).toEqual([]);
  });
});
