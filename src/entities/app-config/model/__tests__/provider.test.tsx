// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppConfigProvider } from "../provider";
import { useAppConfig } from "../useAppConfig";

const loadConfig = vi.fn();
const setRootDirApi = vi.fn();
const chooseRootDirApi = vi.fn();

vi.mock("../../api/config", () => ({
  loadConfig: (...args: unknown[]) => loadConfig(...args),
  saveConfig: vi.fn(),
  backupBrokenConfig: vi.fn(),
}));

vi.mock("../../api/directories", () => ({
  setRootDir: (...args: unknown[]) => setRootDirApi(...args),
  chooseRootDir: (...args: unknown[]) => chooseRootDirApi(...args),
  chooseAiRoot: vi.fn(),
}));

/** 呼び出しの成否と `isLoading` の両方を画面に出す */
function Probe() {
  const { isLoading, error, setRootDir, chooseRootDir } = useAppConfig();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? "-"}</span>
      <button
        data-testid="set"
        onClick={() => {
          void setRootDir("/next");
        }}
      >
        set
      </button>
      <button
        data-testid="choose"
        onClick={() => {
          void chooseRootDir({ force: true });
        }}
      >
        choose
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

  fireEvent.click(screen.getByTestId("set"));
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
   * ピッカーを閉じただけで、設定は1バイトも動いていない。にもかかわらず
   * 「ルートディレクトリの初期化に失敗しました」に差し替わると、利用者は
   * 自分がしていない操作を失敗として名指しされ、元の原因も画面から消える
   */
  it("選び直しを取り消しても、元の失敗の理由を消さない", async () => {
    loadConfig.mockRejectedValue(new Error("壊れている"));
    chooseRootDirApi.mockResolvedValue(null);

    render(
      <AppConfigProvider>
        <Probe />
      </AppConfigProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toContain("設定の読み込みに失敗しました"),
    );

    fireEvent.click(screen.getByTestId("choose"));
    await waitFor(() => expect(loadingText()).toBe("false"));

    expect(screen.getByTestId("error").textContent).toContain("設定の読み込みに失敗しました");
    expect(screen.getByTestId("error").textContent).not.toContain("初期化に失敗");
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
