// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";

/**
 * 更新の知らせの境界と作業画面の境界が、自分の名乗りで畳み、作業画面は移ったら畳みを解くこと。
 *
 * 名乗りを取り違えても型も描画も通る。畳まれた範囲を利用者もログも取り違える。
 * 作業画面の境界は `location.key` で畳みを解くので、`?modal=` のように
 * `pathname` が変わらない遷移でも解ける。`pathname` で見ると、それらの遷移では
 * 畳んだまま残る。
 */

vi.mock("@tauri-apps/api/window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/window")>();
  const mocked = {
    ...actual,
    getCurrentWindow: (() => ({
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
    })) as unknown as typeof actual.getCurrentWindow,
  };
  return mocked satisfies typeof import("@tauri-apps/api/window");
});

const throwing = { updater: false, pane: false };

vi.mock(
  "@/features/updater/ui/UpdaterScreen",
  () =>
    ({
      default: () => {
        if (throwing.updater) throw new Error("更新の知らせの中で落ちた");
        return null;
      },
    }) satisfies typeof import("@/features/updater/ui/UpdaterScreen"),
);
vi.mock(
  "@/app/providers/BootstrapProviders",
  () =>
    ({
      BootstrapProviders: ({ children }: { children: ReactNode }) => <>{children}</>,
    }) satisfies typeof import("@/app/providers/BootstrapProviders"),
);
vi.mock(
  "@/app/routing/AppRouter",
  () =>
    ({
      default: () => <div data-testid="router" />,
    }) satisfies typeof import("@/app/routing/AppRouter"),
);
vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({
      config: { root_dir: "/ws" },
      isLoading: false,
      error: null,
    })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock(
  "@/app/providers/RuntimeProviders",
  () =>
    ({
      RuntimeProviders: ({ children }: { children: ReactNode }) => <>{children}</>,
    }) satisfies typeof import("@/app/providers/RuntimeProviders"),
);

const { default: App } = await import("../App");
const { default: RuntimeShell } = await import("../routing/RuntimeShell");

const OVERLAY_ROOT_ID = "error-overlay-root";

beforeEach(() => {
  throwing.updater = false;
  throwing.pane = false;
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ROOT_ID;
  document.body.appendChild(overlay);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
  vi.restoreAllMocks();
});

describe("境界の名乗り", () => {
  test("更新の知らせが落ちたら、更新の知らせとして畳む", () => {
    throwing.updater = true;
    render(<App />);

    expect(screen.getByText("更新の知らせを表示できませんでした。")).toBeTruthy();
  });
});

describe("作業画面の境界", () => {
  // 境界の外から動かす。畳まれた側の部品は描き終えていないので、そこで取った `navigate` は効かない
  let navigate: ReturnType<typeof useNavigate> = () => {};
  function Navigator() {
    navigate = useNavigate();
    return null;
  }

  function Pane() {
    if (throwing.pane) throw new Error("ペインの中で落ちた");
    return <div>pane</div>;
  }

  test("pathname が変わらない遷移でも、移ったら畳みを解く", () => {
    throwing.pane = true;
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Navigator />
        <Routes>
          <Route element={<RuntimeShell />}>
            <Route path="/app" element={<Pane />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("作業画面を表示できませんでした。")).toBeTruthy();

    throwing.pane = false;
    act(() => navigate("/app?modal=settings"));

    expect(screen.getByText("pane")).toBeTruthy();
  });
});
