// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { TitleBarSlotContext } from "@/shared/ui/titleBarSlot";
import type { HeaderCenterInfo } from "@/widgets/app-layout-header/lib/useHeaderCenterInfo";

/**
 * ヘッダの押下と、開いている棋譜の表示。
 *
 * 押下は URL を書き換えてモーダルを開くので、行き先の綴りを固定する。
 * 綴りがずれると、押しても何も開かない画面になる。
 */

const info = vi.hoisted(() => ({ current: null as unknown as HeaderCenterInfo }));

vi.mock("@/widgets/app-layout-header/lib/useHeaderCenterInfo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/widgets/app-layout-header/lib/useHeaderCenterInfo")>();
  const mocked = { ...actual, useHeaderCenterInfo: () => info.current };
  return mocked satisfies typeof import("@/widgets/app-layout-header/lib/useHeaderCenterInfo");
});

const { default: AppLayoutHeader } = await import("../AppLayoutHeader");

const LOADED: HeaderCenterInfo = {
  hasKifu: true,
  fileLabel: "a",
  fileTitle: "/ws/a.kif",
  tooltip: "a — 先手 先手A / 後手 （不明） — 後手番 3/10",
};

const EMPTY: HeaderCenterInfo = {
  hasKifu: false,
  fileLabel: "ファイル未選択",
  fileTitle: "ファイル未選択",
  tooltip: "ファイル未選択",
};

const location = { search: "" };

function LocationProbe() {
  location.search = useLocation().search;
  return null;
}

function mount(next: HeaderCenterInfo, isSidebarOpen = true) {
  info.current = next;
  const toggleSidebar = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={["/app"]}>
      <AppLayoutHeader toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { toggleSidebar, text: () => view.container.textContent ?? "" };
}

afterEach(() => cleanup());

describe("ヘッダの押下", () => {
  test("サイドバーの開閉は、いまの向きと逆の題を出して呼び手へ渡す", () => {
    const { toggleSidebar } = mount(LOADED, true);

    fireEvent.click(screen.getByTitle("サイドバーを閉じる"));
    expect(toggleSidebar).toHaveBeenCalledTimes(1);

    cleanup();
    mount(LOADED, false);
    expect(screen.getByTitle("サイドバーを開く")).toBeTruthy();
  });

  test("課題局面のボタンは課題局面のモーダルを開く", () => {
    mount(LOADED);

    fireEvent.click(screen.getByRole("button", { name: "課題局面" }));

    expect(new URLSearchParams(location.search).get("modal")).toBe("study-positions");
  });

  test("設定のボタンは設定のワークスペースのタブを開く", () => {
    mount(LOADED);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));

    const params = new URLSearchParams(location.search);
    expect(params.get("modal")).toBe("settings");
    expect(params.get("tab")).toBe("workspace");
  });
});

describe("開いている棋譜", () => {
  test("名前を出し、パスと1行の説明は題にだけ出す", () => {
    const { text } = mount(LOADED);

    expect(screen.getByTitle("/ws/a.kif").textContent).toBe("a");
    expect(screen.getByTitle(LOADED.tooltip)).toBeTruthy();
    expect(text()).not.toContain("先手A");
  });

  test("棋譜が無ければファイル未選択とだけ出す", () => {
    mount(EMPTY);

    const name = screen.getByText("ファイル未選択");
    expect(name.className).toContain("app-header__filename--none");
  });
});

describe("置き場所", () => {
  test("タイトルバーに入れ先があれば、その中へ描く", () => {
    info.current = LOADED;
    const slot = document.createElement("div");
    document.body.append(slot);
    const { container } = render(
      <MemoryRouter initialEntries={["/app"]}>
        <TitleBarSlotContext value={slot}>
          <AppLayoutHeader toggleSidebar={vi.fn()} isSidebarOpen />
        </TitleBarSlotContext>
      </MemoryRouter>,
    );

    expect(within(slot).getByRole("button", { name: "設定" })).toBeTruthy();
    expect(container.textContent).toBe("");
    slot.remove();
  });
});
