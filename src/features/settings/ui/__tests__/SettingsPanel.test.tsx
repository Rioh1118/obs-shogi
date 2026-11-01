// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * 設定の枠。URL の `tab` から中身を決め、タブを押すと URL を書き換える。
 * タブの中身はそれぞれのテストが見るので、ここでは差し替える。
 */

const world = vi.hoisted(() => ({
  tab: undefined as string | undefined,
  updateParams: vi.fn(),
}));

vi.mock("@/shared/lib/router/useURLParams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/router/useURLParams")>();
  return {
    ...actual,
    useURLParams: () =>
      ({
        params: { tab: world.tab },
        updateParams: world.updateParams,
      }) as unknown as ReturnType<typeof actual.useURLParams>,
  } satisfies typeof import("@/shared/lib/router/useURLParams");
});

vi.mock(
  "../tabs/WorkspaceTab",
  () => ({ default: () => <p>中身:workspace</p> }) satisfies typeof import("../tabs/WorkspaceTab"),
);
vi.mock(
  "../tabs/AiLibraryTab",
  () => ({ default: () => <p>中身:aiLibrary</p> }) satisfies typeof import("../tabs/AiLibraryTab"),
);
vi.mock(
  "../tabs/EngineTab",
  () => ({ default: () => <p>中身:engine</p> }) satisfies typeof import("../tabs/EngineTab"),
);
vi.mock(
  "../tabs/DisplayTab",
  () => ({ default: () => <p>中身:display</p> }) satisfies typeof import("../tabs/DisplayTab"),
);

const { default: SettingsPanel } = await import("../SettingsPanel");

const tabButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  world.tab = undefined;
  world.updateParams.mockReset();
});

afterEach(cleanup);

describe("設定の枠", () => {
  test.each([
    ["workspace", "中身:workspace"],
    ["aiLibrary", "中身:aiLibrary"],
    ["engine", "中身:engine"],
    ["display", "中身:display"],
  ])("`tab=%s` の中身を出す", (tab, text) => {
    world.tab = tab;
    render(<SettingsPanel />);

    expect(screen.getByText(text)).toBeTruthy();
  });

  test.each([undefined, "create", "toString"])("知らない綴り %s は既定のタブへ落ちる", (tab) => {
    world.tab = tab;
    render(<SettingsPanel />);

    expect(screen.getByText("中身:workspace")).toBeTruthy();
  });

  test("タブを押すと履歴を積まずに URL を書き換える", () => {
    render(<SettingsPanel />);

    fireEvent.click(tabButton(/^表示/));

    expect(world.updateParams).toHaveBeenCalledWith({ tab: "display" }, { replace: true });
  });

  test("いまのタブだけを印す", () => {
    world.tab = "engine";
    render(<SettingsPanel />);

    expect(tabButton(/^エンジン管理/).getAttribute("aria-current")).toBe("page");
    expect(tabButton(/^表示/).getAttribute("aria-current")).toBeNull();
    expect(tabButton(/^エンジン管理/).className).toContain("stab--active");
    expect(tabButton(/^表示/).className).not.toContain("stab--active");
  });

  test("外のものを指す2枚にだけ札が付く", () => {
    render(<SettingsPanel />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "ワークスペース",
      "AI ライブラリ要設定注意",
      "エンジン管理要設定注意",
      "表示",
    ]);
    const labels = tabButton(/^AI ライブラリ/).querySelectorAll(".sbadge");
    expect([...labels].map((b) => b.className)).toEqual([
      "sbadge sbadge--muted sbadge--badge",
      "sbadge sbadge--danger sbadge--badge",
    ]);
  });
});
