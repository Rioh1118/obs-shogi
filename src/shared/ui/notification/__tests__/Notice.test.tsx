// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Notice from "../Notice";

/**
 * 通知の中身。**ここが黙ると、失敗はどこにも出ない。**
 * 「出ないまま緑になる」形を作らないため、出ていることを本文で確かめる。
 */

afterEach(cleanup);

function show(props: Partial<React.ComponentProps<typeof Notice>> = {}) {
  return render(<Notice tier="warning" title="保存できませんでした" {...props} />);
}

describe("通知の中身", () => {
  it("題と本文を出す", () => {
    show({ body: "書き込み先が読み取り専用です" });

    expect(screen.getByText("保存できませんでした")).toBeTruthy();
    expect(screen.getByText("書き込み先が読み取り専用です")).toBeTruthy();
  });

  it("本文が無くても題だけで出る", () => {
    show();

    expect(screen.getByText("保存できませんでした")).toBeTruthy();
  });

  describe("件数", () => {
    it("渡したときだけ出す", () => {
      show({ count: 37 });

      expect(screen.getByText("37件")).toBeTruthy();
    });

    // 畳んでいない通知に常に「1件」が付くと、数そのものに意味が無くなる
    it("渡さなければ出さない", () => {
      show();

      expect(screen.queryByText(/件$/)).toBeNull();
    });

    it("1件目から出す", () => {
      show({ count: 1 });

      expect(screen.getByText("1件")).toBeTruthy();
    });
  });

  describe("動作", () => {
    it("押すと走る", async () => {
      const run = vi.fn();
      show({ actions: [{ label: "再試行", run }] });

      await act(async () => screen.getByRole("button", { name: "再試行" }).click());

      expect(run).toHaveBeenCalledOnce();
    });

    it("動作が無ければボタンを出さない", () => {
      show();

      expect(screen.queryAllByRole("button")).toEqual([]);
    });

    it("2つ並べられる", () => {
      show({
        actions: [
          { label: "再試行", run: vi.fn() },
          { label: "エンジンを再起動", run: vi.fn() },
        ],
      });

      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "再試行",
        "エンジンを再起動",
      ]);
    });

    it("走っている間は待っていることを伝える", async () => {
      let release!: () => void;
      const run = () => new Promise<void>((resolve) => (release = resolve));
      show({ actions: [{ label: "再試行", run }] });

      const button = screen.getByRole("button", { name: "再試行" });
      await act(async () => button.click());

      expect(button.getAttribute("aria-busy")).toBe("true");

      release();
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
    });

    /**
     * **動作そのものが失敗したことを握り潰さない。** console に落とすと、
     * 押した人には何も起きなかったようにしか見えない。
     * 通知の中で失敗を出すのがこの基盤の存在理由なので、
     * その基盤自身が黙る経路を残さない
     */
    it("動作が失敗したら、その場に理由を出す", async () => {
      const run = () => Promise.reject(new Error("engine is gone"));
      show({ actions: [{ label: "再試行", run }] });

      await act(async () => screen.getByRole("button", { name: "再試行" }).click());

      expect(await screen.findByText("「再試行」を実行できませんでした。")).toBeTruthy();
    });

    /**
     * 「実行できませんでした」だけでは次に何をすればよいかが無く、同じボタンを
     * 押し続けることになる。ADR-0004 が「押しても直らない失敗に動作を付けない」と
     * 決めた状態を、基盤の側で作ってしまう。
     */
    it("動作が次の一手を持っていれば、失敗と一緒に出す", async () => {
      show({
        actions: [
          {
            label: "エンジンを再起動",
            run: () => Promise.reject(new Error("engine binary not found")),
            failureBody: "設定タブでエンジンのパスを確かめてください。",
          },
        ],
      });

      await act(async () => screen.getByRole("button", { name: "エンジンを再起動" }).click());

      const text = (await screen.findByRole("alert")).textContent ?? "";
      expect(text).toContain("「エンジンを再起動」を実行できませんでした。");
      expect(text).toContain("設定タブでエンジンのパスを確かめてください。");
    });

    // 画面には利用者の言葉、原因はログ。例外を捨てると後から誰も辿れない
    it("原因をログに残す", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const cause = new Error("engine binary not found");
      show({ actions: [{ label: "再試行", run: () => Promise.reject(cause) }] });

      await act(async () => screen.getByRole("button", { name: "再試行" }).click());
      await screen.findByRole("alert");

      expect(spy).toHaveBeenCalledWith(expect.stringContaining("再試行"), cause);
      spy.mockRestore();
    });

    it("同期で投げた場合も出す", async () => {
      const run = () => {
        throw new Error("boom");
      };
      show({ actions: [{ label: "再試行", run }] });

      await act(async () => screen.getByRole("button", { name: "再試行" }).click());

      expect(await screen.findByText("「再試行」を実行できませんでした。")).toBeTruthy();
    });

    // 失敗したまま押せなくすると、一時的な失敗から復帰する手段が消える
    it("失敗したあとも押せる", async () => {
      const run = vi.fn(() => Promise.reject(new Error("boom")));
      show({ actions: [{ label: "再試行", run }] });

      const button = screen.getByRole("button", { name: "再試行" });
      await act(async () => button.click());
      await screen.findByText("「再試行」を実行できませんでした。");
      await act(async () => button.click());

      expect(run).toHaveBeenCalledTimes(2);
    });

    it("押し直したら前の失敗が消える", async () => {
      let fail = true;
      const run = () => (fail ? Promise.reject(new Error("boom")) : Promise.resolve());
      show({ actions: [{ label: "再試行", run }] });

      const button = screen.getByRole("button", { name: "再試行" });
      await act(async () => button.click());
      await screen.findByText("「再試行」を実行できませんでした。");

      fail = false;
      await act(async () => button.click());

      await waitFor(() =>
        expect(screen.queryByText("「再試行」を実行できませんでした。")).toBeNull(),
      );
    });
  });

  describe("支援技術への出し方", () => {
    // 繰り返しでは直らない段は、読んでいるものを中断してでも伝える
    it.each([
      ["danger", "alert"],
      ["fatal", "alert"],
      ["info", "status"],
      ["warning", "status"],
    ] as const)("%s は role=%s", (tier, role) => {
      show({ tier });

      expect(screen.getByRole(role)).toBeTruthy();
    });
  });

  it("閉じる手段は渡したときだけ出す", async () => {
    const onDismiss = vi.fn();
    const { rerender } = show({ onDismiss });

    await act(async () => screen.getByRole("button", { name: "閉じる" }).click());
    expect(onDismiss).toHaveBeenCalledOnce();

    rerender(<Notice tier="warning" title="保存できませんでした" />);
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
  });

  it("段が class に出る", () => {
    const { container } = show({ tier: "fatal" });

    expect(container.querySelector(".notice--fatal")).toBeTruthy();
  });
});
