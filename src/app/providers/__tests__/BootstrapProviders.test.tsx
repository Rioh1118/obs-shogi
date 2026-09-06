// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootstrapProviders } from "../BootstrapProviders";
import { useNotifications } from "@/shared/lib/notification/useNotifications";

/**
 * **通知が実際に画面へ出るところまでを見る。**
 *
 * 置き場と部品それぞれの検査が緑でも、器に載っていなければ通知は1件も出ない。
 * それはこのエピックが直そうとしている形そのもの（置き場だけが作られ、
 * 表示する場所が作られていない）なので、載っていることを別に固定する。
 */

// 設定の読み込みは Tauri を叩く。ここで見たいのは通知の経路だけなので、
// 起動時の読み込みは失敗させたまま素通しする（provider が自分で握る）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.reject(new Error("no tauri in tests")),
}));

afterEach(cleanup);

function Failing() {
  const { notify } = useNotifications();
  return (
    <button
      type="button"
      onClick={() =>
        notify({
          tier: "danger",
          presentation: "toast",
          title: "エンジンを初期化できませんでした",
          actions: [{ label: "設定を開く", run: () => {} }],
        })
      }
    >
      失敗させる
    </button>
  );
}

describe("起動時の器", () => {
  it("配下から出した通知が画面に出る", async () => {
    render(
      <BootstrapProviders>
        <Failing />
      </BootstrapProviders>,
    );

    const layer = () => document.querySelector(".notice-layer__toasts");
    expect(layer()).toBeNull();

    await act(async () => screen.getByRole("button", { name: "失敗させる" }).click());

    // 読み上げの領域にも同じ文字が出るので、通知の入れ物を指して数える
    expect(layer()!.textContent).toContain("エンジンを初期化できませんでした");
    expect(screen.getByRole("button", { name: "設定を開く" })).toBeTruthy();
  });

  it("閉じると消える", async () => {
    render(
      <BootstrapProviders>
        <Failing />
      </BootstrapProviders>,
    );

    await act(async () => screen.getByRole("button", { name: "失敗させる" }).click());
    await act(async () => screen.getByRole("button", { name: "閉じる" }).click());

    expect(document.querySelector(".notice-layer__toasts")).toBeNull();
  });
});
