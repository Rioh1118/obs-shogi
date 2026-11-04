// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { GOTE_GLYPH, SENTE_GLYPH } from "@/shared/lib/turn";
import type { HeaderCenterInfo } from "@/widgets/app-layout-header/lib/useHeaderCenterInfo";

/**
 * ヘッダの押下と、対局者の欄の描き分け。
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
  senteName: "先手A",
  goteName: null,
  isPlayersShown: true,
  turnGlyph: "☖",
  turnText: "後手番",
  tesuuText: "3手目",
  totalText: "3/10",
  tooltip: "a — 先手 先手A / 後手 （不明） — 後手番 3/10",
};

const EMPTY: HeaderCenterInfo = {
  ...LOADED,
  hasKifu: false,
  fileLabel: "ファイル未選択",
  fileTitle: "ファイル未選択",
  senteName: null,
  isPlayersShown: false,
  tesuuText: "",
  totalText: "",
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

describe("ヘッダの中央", () => {
  test("棋譜が載っていれば手番と手数を出し、欠けた対局者は手番の名で埋める", () => {
    const { text } = mount(LOADED);

    expect(text()).toContain("☖ 後手番");
    expect(text()).toContain("3手目");
    expect(screen.getByLabelText("対局者").textContent).toBe(
      `${SENTE_GLYPH}先手A・${GOTE_GLYPH}後手`,
    );
  });

  test("対局者が居なければ、対局者の欄の代わりに棋譜表示中と出す", () => {
    const { text } = mount({ ...LOADED, senteName: null, isPlayersShown: false });

    expect(text()).toContain("棋譜表示中");
    expect(screen.queryByLabelText("対局者")).toBeNull();
  });

  test("棋譜が無ければファイル未選択だけを出す", () => {
    const { text } = mount(EMPTY);

    expect(text()).toContain("ファイル未選択");
    expect(text()).not.toContain("棋譜表示中");
    expect(text()).not.toContain("後手番");
  });
});
