// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppConfigProvider } from "../provider";
import { useAppConfig } from "../useAppConfig";

const loadConfig = vi.fn();
const setRootDirApi = vi.fn();

vi.mock("../../api/config", () => ({
  loadConfig: (...args: unknown[]) => loadConfig(...args),
  saveConfig: vi.fn(),
}));

vi.mock("../../api/directories", () => ({
  setRootDir: (...args: unknown[]) => setRootDirApi(...args),
  chooseRootDir: vi.fn(),
  chooseAiRoot: vi.fn(),
}));

/** 呼び出しの成否と `isLoading` の両方を画面に出す */
function Probe() {
  const { isLoading, error, setRootDir } = useAppConfig();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? "-"}</span>
      <button
        onClick={() => {
          void setRootDir("/next");
        }}
      >
        set
      </button>
    </div>
  );
}

function loadingText() {
  return screen.getByTestId("loading").textContent;
}

async function mountAndFail() {
  setRootDirApi.mockRejectedValue(new Error("書けない"));

  render(
    <AppConfigProvider>
      <Probe />
    </AppConfigProvider>,
  );
  await waitFor(() => expect(loadingText()).toBe("false"));

  fireEvent.click(screen.getByRole("button"));
  // 押した直後に `true` になっていることまで見る。見ないと、降ろし損ねの変異でも
  // 「最初から false のまま」で緑になり、この検査が空振りする
  expect(loadingText()).toBe("true");
}

describe("AppConfigProvider", () => {
  afterEach(cleanup);

  beforeEach(() => {
    loadConfig.mockReset();
    setRootDirApi.mockReset();
    loadConfig.mockResolvedValue({ root_dir: "/old", ai_root: null });
  });

  /**
   * `loading` を立てた出口が1つでも降ろし損ねると、`isLoading` を見て
   * 無効化されている操作（設定タブのボタン、起動時の分岐）が二度と押せなくなる。
   * 失敗を戻り値で返す経路は `error` を積まないので、降ろす側も別に要る
   */
  it("設定の更新に失敗しても isLoading を降ろす", async () => {
    await mountAndFail();

    await waitFor(() => expect(loadingText()).toBe("false"));
  });

  /**
   * 失敗を `error` に積むと `RequireRootDir` がランタイムごと畳むので、
   * 呼び出し元が出そうとした失敗が画面に出る前に消える
   */
  it("設定の更新の失敗を error に積まない", async () => {
    await mountAndFail();

    await waitFor(() => expect(loadingText()).toBe("false"));
    expect(screen.getByTestId("error").textContent).toBe("-");
  });
});
