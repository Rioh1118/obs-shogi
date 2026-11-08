// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router";
import type { ReactElement } from "react";

/**
 * 起動画面から作業画面へ移るとき、履歴を積まないこと。
 *
 * 積むと、作業画面で戻るを押したときに起動画面へ戻る。`/app` の index は
 * `panel/filetree` へ置き換えで飛ぶので、`AppRouter` ごと描くと最後の遷移が
 * いつも置き換えに見える。ここは `/app` を飛ばない部品にして、起動画面から
 * `/app` へ来た遷移そのものの種類を読む。
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

const { default: AppLoading } = await import("../AppLoading");
const { default: FolderSelect } = await import("../FolderSelect");

let at = { pathname: "", navigationType: "" };
function Arrived() {
  at = { pathname: useLocation().pathname, navigationType: useNavigationType() };
  return <div>arrived</div>;
}

function tree(start: ReactElement) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={start} />
        <Route path="/app" element={<Arrived />} />
      </Routes>
    </MemoryRouter>
  );
}

function mount(start: ReactElement) {
  return render(tree(start));
}

async function choose() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
  });
}

beforeEach(() => {
  state.config = null;
  state.isLoading = false;
  state.error = null;
  chooseRootDir.mockReset();
  at = { pathname: "", navigationType: "" };
});
afterEach(cleanup);

describe("起動画面から作業画面へ", () => {
  test("根があれば、置き換えで作業画面へ移る", () => {
    state.config = { root_dir: "/ws" };
    mount(<AppLoading />);

    expect(at).toEqual({ pathname: "/app", navigationType: "REPLACE" });
  });

  test("フォルダを選べたら、置き換えで作業画面へ移る", async () => {
    state.config = { root_dir: null };
    chooseRootDir.mockResolvedValue("/ws");
    mount(<FolderSelect />);

    await choose();

    expect(at).toEqual({ pathname: "/app", navigationType: "REPLACE" });
  });

  test("設定が読めなかった画面でも、選べたら置き換えで移る", async () => {
    state.error = "設定の読み込みに失敗しました";
    chooseRootDir.mockResolvedValue("/ws");
    mount(<AppLoading />);

    await choose();

    expect(at).toEqual({ pathname: "/app", navigationType: "REPLACE" });
  });

  test("選ぶ操作を通らずに根が入っても、置き換えで作業画面へ移る", () => {
    state.config = { root_dir: null };
    const view = mount(<FolderSelect />);
    expect(screen.queryByText("arrived")).toBeNull();

    state.config = { root_dir: "/ws" };
    view.rerender(tree(<FolderSelect />));

    expect(at).toEqual({ pathname: "/app", navigationType: "REPLACE" });
  });
});
