// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationProvider } from "@/shared/lib/notification/provider";
import { useNotifications } from "@/shared/lib/notification/useNotifications";
import type { NotifyAction, NotifyRequest, VisibleTier } from "@/shared/lib/notification/types";
import NotificationLayer from "../NotificationLayer";

/**
 * グローバルの3経路を1箇所で描く層。
 *
 * **「出ないまま緑になる」形を作らない。** 出した通知が画面の文字として
 * 見つかることまで確かめる。
 */

afterEach(cleanup);

function setup() {
  let notify!: (request: NotifyRequest) => void;

  function Handle() {
    notify = useNotifications().notify;
    return null;
  }

  render(
    <NotificationProvider>
      <Handle />
      <NotificationLayer />
    </NotificationProvider>,
  );

  return { notify: (request: NotifyRequest) => act(() => notify(request)) };
}

/** 見せ方を変える口は別に持つ。spread で差し替えると union の枝が決まらない */
const request = (
  over: { tier?: VisibleTier; title?: string; actions?: NotifyAction[]; dedupeKey?: string } = {},
): NotifyRequest => ({
  tier: "warning",
  presentation: "toast",
  title: "解析を停止できませんでした",
  ...over,
});

const shownAs = (
  presentation: "banner" | "modal",
  over: { title?: string } = {},
): NotifyRequest => ({
  tier: "warning",
  presentation,
  title: "解析を停止できませんでした",
  ...over,
});

/** 見せ方ごとの入れ物。class で引くのは、位置を決めているのがそこだから */
const boxOf = (selector: string) => document.querySelector(selector);

describe("通知の層", () => {
  it("何も出ていなければ通知を描かない", () => {
    setup();

    expect(boxOf(".notice-layer__toasts")).toBeNull();
    expect(boxOf(".notice-layer__banners")).toBeNull();
  });

  it("トーストが右下の入れ物に出る", () => {
    const app = setup();
    app.notify(request());

    const toast = boxOf(".notice-layer__toasts")?.querySelector(".notice--toast");
    expect(toast).toBeTruthy();
    expect(toast!.textContent).toContain("解析を停止できませんでした");
  });

  it("バナーは帯の入れ物に出る", () => {
    const app = setup();
    app.notify(shownAs("banner", { title: "エンジンを起動できません" }));

    expect(boxOf(".notice-layer__banners")?.textContent).toContain("エンジンを起動できません");
    expect(boxOf(".notice-layer__toasts")).toBeNull();
  });

  it("モーダルは Modal として出る", () => {
    const app = setup();
    app.notify(shownAs("modal", { title: "ファイルを削除できませんでした" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("ファイルを削除できませんでした");
  });

  /**
   * `Modal` は Escape とオーバーレイでも閉じるが、**どちらも画面に出ていない**。
   * 押すものが1つも無い画面は行き止まりに見えるので、目に見える出口を要求する
   */
  it("モーダルには目に見える閉じる手段がある", async () => {
    const app = setup();
    app.notify(shownAs("modal", { title: "ファイルを削除できませんでした" }));

    await act(async () => screen.getByRole("button", { name: "閉じる" }).click());

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * 2枚目が上に乗ると、1枚目を読み終える前に塞がれる。
   * 出た順の先頭を出し切ってから次へ進む
   */
  it("モーダルは1枚しか出さない", () => {
    const app = setup();
    app.notify(shownAs("modal", { title: "1枚目" }));
    app.notify(shownAs("modal", { title: "2枚目" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("1枚目");
  });

  /**
   * モーダルは1枚ずつなので、**2枚目は1枚目が消えた瞬間に同じ位置へ入る**。
   * React は位置で照合するので、`key` を付けないと `Notice` が再マウントされず、
   * 1枚目で動作が失敗したときの理由が2枚目の本文の下に残る。
   */
  it("前のモーダルで出た動作の失敗が、次のモーダルに残らない", async () => {
    const app = setup();
    app.notify({
      tier: "warning",
      presentation: "modal",
      title: "1枚目",
      actions: [{ label: "再試行", run: () => Promise.reject(new Error("boom")) }],
    });

    await act(async () => screen.getByRole("button", { name: "再試行" }).click());
    await screen.findByText("「再試行」を実行できませんでした。");

    app.notify(shownAs("modal", { title: "2枚目" }));
    await act(async () => screen.getAllByRole("button", { name: "閉じる" })[0].click());

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("2枚目");
    expect(screen.queryByText("「再試行」を実行できませんでした。")).toBeNull();
  });

  /**
   * 畳まれると `actions` が丸ごと差し替わるのに id は動かない（再マウントしない）。
   * 走っているものを添字で覚えていると、**一度も押していないボタンが busy かつ
   * 押せない状態で残る**。押せなくなるのはたいてい「エンジンが応答しない」ときで、
   * 唯一の復帰導線がそれになる。
   */
  it("畳まれて動作が差し替わっても、押していないボタンは押せる", async () => {
    const app = setup();
    // 返らない動作。エンジンが死んでいる状態そのもの
    const stuck = { label: "再試行", run: () => new Promise<void>(() => {}) };
    app.notify(request({ dedupeKey: "analysis", actions: [stuck] }));

    await act(async () => screen.getByRole("button", { name: "再試行" }).click());
    expect(screen.getByRole("button", { name: "再試行" }).getAttribute("aria-busy")).toBe("true");

    app.notify(
      request({ dedupeKey: "analysis", actions: [{ label: "エンジンを再起動", run: () => {} }] }),
    );

    const button = screen.getByRole("button", { name: "エンジンを再起動" });
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("差し替えられた動作の失敗が、新しいボタンの下に残らない", async () => {
    const app = setup();
    app.notify(
      request({
        dedupeKey: "analysis",
        actions: [{ label: "再試行", run: () => Promise.reject(new Error("boom")) }],
      }),
    );

    await act(async () => screen.getByRole("button", { name: "再試行" }).click());
    await screen.findByText("「再試行」を実行できませんでした。");

    app.notify(
      request({ dedupeKey: "analysis", actions: [{ label: "エンジンを再起動", run: () => {} }] }),
    );

    expect(screen.queryByText("「再試行」を実行できませんでした。")).toBeNull();
  });

  /**
   * 入れ物は高さに上限を持ち、溢れたぶんは巻き取られる。`scrollTop` の初期値は 0 で
   * 見えているのは先頭なので、**出た順のまま並べると巻き取られるのが常に新着側**になる。
   * 失敗が続いている間に出た最後の1件——いちばん段が重いことが多い——が
   * 一度も画面に出ない。高さは happy-dom で測れないので、DOM の並びで固定する。
   */
  it.each([
    ["toast", ".notice-layer__toasts", () => request({ title: "1件目" })],
    ["banner", ".notice-layer__banners", () => shownAs("banner", { title: "1件目" })],
  ] as const)("%s は新着が入れ物の先頭に来る", (_name, selector, first) => {
    const app = setup();
    app.notify(first());
    app.notify(
      selector === ".notice-layer__toasts"
        ? request({ title: "2件目" })
        : shownAs("banner", { title: "2件目" }),
    );

    const titles = [...boxOf(selector)!.querySelectorAll(".notice__title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["2件目", "1件目"]);
  });

  it("見せ方が違えば同時に出る", () => {
    const app = setup();
    app.notify(request({ title: "トースト" }));
    app.notify(shownAs("banner", { title: "バナー" }));

    // 読み上げの領域にも同じ文字が出るので、入れ物を指して数える
    expect(boxOf(".notice-layer__toasts")!.textContent).toContain("トースト");
    expect(boxOf(".notice-layer__banners")!.textContent).toContain("バナー");
  });

  it("閉じると消える", async () => {
    const app = setup();
    app.notify(request());

    await act(async () => screen.getByRole("button", { name: "閉じる" }).click());

    expect(screen.queryByText("解析を停止できませんでした")).toBeNull();
  });

  describe("件数", () => {
    it("畳む鍵を持つ通知にだけ出す", () => {
      const app = setup();
      app.notify(request({ dedupeKey: "sfen", title: "局面を読めませんでした" }));
      app.notify(request({ dedupeKey: "sfen", title: "局面を読めませんでした" }));

      expect(screen.getByText("2件")).toBeTruthy();
    });

    it("鍵の無い通知には出さない", () => {
      const app = setup();
      app.notify(request());

      expect(screen.queryByText(/^\d+件$/)).toBeNull();
    });
  });

  /**
   * `role="status"` は「既に文書に在る領域の中身が変わったとき」に読まれる規約。
   * 領域と本文を同じ描画で挿し込むと、読まれるかが支援技術の実装依存になる。
   * **出ているのに読まれない**のは、この基盤が直そうとしている形そのもの。
   */
  describe("読み上げの領域", () => {
    const announce = () => boxOf(".notice-layer__announce");

    it("通知が1つも無くても木に在る", () => {
      setup();

      expect(announce()).not.toBeNull();
      expect(announce()!.getAttribute("aria-live")).toBe("polite");
    });

    it("最後に積まれた通知の題と本文が流れる", () => {
      const app = setup();
      app.notify(request({ title: "1件目" }));
      app.notify(shownAs("banner", { title: "2件目" }));

      expect(announce()!.textContent).toBe("2件目");
    });

    it("見せ方に関わらず流れる", () => {
      const app = setup();
      app.notify(shownAs("modal", { title: "ファイルを削除できませんでした" }));

      expect(announce()!.textContent).toContain("ファイルを削除できませんでした");
    });
  });

  it("silent は何も描かない", () => {
    const app = setup();
    app.notify({ tier: "silent", reason: "cancelSearch は no-op として通るのが仕様" });

    expect(screen.queryByText("解析を停止できませんでした")).toBeNull();
  });

  it("動作を押すと走る", async () => {
    const app = setup();
    let ran = false;
    app.notify(request({ actions: [{ label: "再試行", run: () => void (ran = true) }] }));

    await act(async () => screen.getByRole("button", { name: "再試行" }).click());

    expect(ran).toBe(true);
  });
});
