// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * 設定のパネル。URL の `tab` から中身を決め、タブを押すと URL を書き換える。
 * タブの中身はそれぞれのテストが見るので、ここでは差し替える。
 */

const world = vi.hoisted(() => ({
  tab: undefined as string | undefined,
  needs: new Set<"workspace" | "aiLibrary" | "engine" | "display">(),
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

vi.mock("@/features/settings/model/useSetupNeeds", () => {
  const mocked = { useSetupNeeds: () => world.needs };
  return mocked satisfies typeof import("@/features/settings/model/useSetupNeeds");
});

const { default: SettingsPanel } = await import("../SettingsPanel");

const tabButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  world.tab = undefined;
  world.needs = new Set();
  world.updateParams.mockReset();
});

afterEach(cleanup);

describe("設定のパネル", () => {
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
    expect(tabButton(/^エンジン管理/).hasAttribute("data-initial-focus")).toBe(true);
    expect(tabButton(/^表示/).hasAttribute("data-initial-focus")).toBe(false);
    expect(tabButton(/^エンジン管理/).className).toContain("stab--active");
    expect(tabButton(/^表示/).className).not.toContain("stab--active");
  });

  test("設定が要るタブにだけ、名前の右に記号を付ける", () => {
    world.needs = new Set(["engine"]);
    render(<SettingsPanel />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "ワークスペース",
      "AI ライブラリ",
      "エンジン管理",
      "表示",
    ]);
    expect(screen.getAllByRole("img", { name: "設定が要ります" })).toHaveLength(1);
    expect(tabButton(/^エンジン管理/).querySelector('[role="img"]')).not.toBeNull();
  });

  test("要らなければ何も付けない", () => {
    render(<SettingsPanel />);

    expect(screen.queryByRole("img", { name: "設定が要ります" })).toBeNull();
  });

  // 一覧だけを送るタブ。骨組みの側が送ると、上の「詰み探索」ごと流れる
  test("いまのタブを、送り方の目印に出す", () => {
    world.tab = "engine";
    const { container } = render(<SettingsPanel />);

    expect(container.querySelector<HTMLElement>(".settings__main")?.dataset.tab).toBe("engine");
  });
});
