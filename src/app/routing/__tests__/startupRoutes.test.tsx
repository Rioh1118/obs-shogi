// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router";

/**
 * 起動してから作業面に着くまでの行き先。
 *
 * 設定を読んでいる間は起動画面、根が無ければフォルダの選択、根があれば `/app` の
 * `panel/filetree`。どれを踏み外しても例外は出ず、別の画面に着くか、戻るで
 * 起動画面へ戻れてしまうだけになる。`error` が立っている間の往復は
 * `startupErrorRoute.test.tsx` が見る。
 */

const state = {
  config: null as { root_dir: string | null } | null,
  isLoading: false,
  error: null as string | null,
};
const chooseRootDir = vi.fn<(opts: { force: boolean }) => Promise<string | null>>();

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({ ...state, chooseRootDir })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock(
  "@/widgets/boot-splash/ui/BootSplash",
  () =>
    ({
      default: () => <div>splash</div>,
    }) satisfies typeof import("@/widgets/boot-splash/ui/BootSplash"),
);
// `/app` の中身はこの検査の対象外。着いた先の綴りだけを見る
vi.mock("@/app/routing/RuntimeShell", async () => {
  const { Outlet } = await import("react-router");
  return {
    default: () => <Outlet />,
  } satisfies typeof import("@/app/routing/RuntimeShell");
});
vi.mock("@/pages/AppLayout", async () => {
  const { Outlet } = await import("react-router");
  return {
    default: () => (
      <div data-testid="layout">
        <Outlet />
      </div>
    ),
  } satisfies typeof import("@/pages/AppLayout");
});
vi.mock(
  "@/widgets/file-tree/ui/FileTree",
  () =>
    ({
      default: () => <div data-testid="filetree" />,
    }) satisfies typeof import("@/widgets/file-tree/ui/FileTree"),
);

const { default: AppRouter } = await import("../AppRouter");
const { RequireRootDir } = await import("../guards/RequireRootDir");

/** いまの場所と、そこへ来た遷移の種類 */
let at = { pathname: "", navigationType: "" };
function Probe() {
  const location = useLocation();
  at = { pathname: location.pathname, navigationType: useNavigationType() };
  return null;
}

function mountApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <AppRouter />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.config = null;
  state.isLoading = false;
  state.error = null;
  chooseRootDir.mockReset();
  at = { pathname: "", navigationType: "" };
});
afterEach(cleanup);

describe("起動の画面", () => {
  test("設定を読んでいる間は起動画面を出す", () => {
    state.isLoading = true;
    state.config = { root_dir: "/ws" };
    mountApp("/");

    expect(screen.getByText("splash")).toBeTruthy();
    expect(at.pathname).toBe("/");
  });

  test("根が無ければフォルダを選ばせる", () => {
    state.config = { root_dir: null };
    mountApp("/");

    expect(screen.getByText("あなたの定跡を整理するノートアプリへようこそ")).toBeTruthy();
    expect(screen.getByRole("button", { name: "フォルダを選択" })).toBeTruthy();
    expect(at.pathname).toBe("/");
  });

  test("根があれば、履歴を積まずにファイルツリーへ着く", () => {
    state.config = { root_dir: "/ws" };
    mountApp("/");

    expect(at).toEqual({ pathname: "/app/panel/filetree", navigationType: "REPLACE" });
    expect(screen.getByTestId("layout").contains(screen.getByTestId("filetree"))).toBe(true);
  });

  test("フォルダを選べたら、履歴を積まずに作業面へ移る", async () => {
    state.config = { root_dir: null };
    chooseRootDir.mockResolvedValue("/ws");
    mountApp("/");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    });

    expect(chooseRootDir).toHaveBeenCalledWith({ force: true });
    expect(at).toEqual({ pathname: "/app/panel/filetree", navigationType: "REPLACE" });
  });

  test("選ばずに閉じたら動かない", async () => {
    state.config = { root_dir: null };
    chooseRootDir.mockResolvedValue(null);
    mountApp("/");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    });

    expect(at.pathname).toBe("/");
  });

  test("設定が読めなかった画面でも、選べたら作業面へ移る", async () => {
    state.error = "設定の読み込みに失敗しました";
    chooseRootDir.mockResolvedValue("/ws");
    mountApp("/");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    });

    expect(at).toEqual({ pathname: "/app/panel/filetree", navigationType: "REPLACE" });
  });
});

describe("作業面の前の確かめ", () => {
  function mountGuard() {
    return render(
      <MemoryRouter initialEntries={["/app"]}>
        <Probe />
        <Routes>
          <Route path="/" element={<div>root</div>} />
          <Route
            path="/app"
            element={
              <RequireRootDir>
                <div>app</div>
              </RequireRootDir>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  test("初めて読んでいる間は起動画面を出し、中身を描かない", () => {
    state.isLoading = true;
    mountGuard();

    expect(screen.getByText("splash")).toBeTruthy();
    expect(screen.queryByText("app")).toBeNull();
  });

  test("読み直している間は、前の設定のまま中身を描き続ける", () => {
    state.isLoading = true;
    state.config = { root_dir: "/ws" };
    mountGuard();

    expect(screen.getByText("app")).toBeTruthy();
  });

  test("根が無ければ、履歴を積まずに最初の画面へ戻す", () => {
    state.config = { root_dir: null };
    mountGuard();

    expect(at).toEqual({ pathname: "/", navigationType: "REPLACE" });
  });

  test("設定が読めていなければ最初の画面へ戻す", () => {
    mountGuard();

    expect(at.pathname).toBe("/");
  });

  test("根があっても、失敗が立っていれば最初の画面へ戻す", () => {
    state.config = { root_dir: "/ws" };
    state.error = "設定の保存に失敗しました";
    mountGuard();

    expect(at).toEqual({ pathname: "/", navigationType: "REPLACE" });
  });

  test("根があれば中身を描く", () => {
    state.config = { root_dir: "/ws" };
    mountGuard();

    expect(screen.getByText("app")).toBeTruthy();
    expect(at.pathname).toBe("/app");
  });
});
