// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppConfigProvider } from "../provider";
import { useAppConfig } from "../useAppConfig";
import type { AppConfig } from "../types";
import type { PresetId } from "@/entities/engine-presets/model/types";

let disk: AppConfig = { root_dir: "/old", ai_root: null };
const loadConfig = vi.fn();
const saveConfig = vi.fn();
const setRootDirApi = vi.fn();
const chooseRootDirApi = vi.fn();
const chooseAiRootApi = vi.fn();

vi.mock("../../api/config", () => ({
  loadConfig: (...args: unknown[]) => loadConfig(...args),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
  backupBrokenConfig: vi.fn(),
}));

vi.mock("../../api/directories", () => ({
  setRootDir: (...args: unknown[]) => setRootDirApi(...args),
  chooseRootDir: (...args: unknown[]) => chooseRootDirApi(...args),
  chooseAiRoot: (...args: unknown[]) => chooseAiRootApi(...args),
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

/** 表示の設定を2つ、**保存が返る前に**続けて押す */
function DisplayProbe() {
  const { setDisplayConfig } = useAppConfig();
  return (
    <div>
      <button
        data-testid="startup"
        onClick={() => {
          void setDisplayConfig({ dock_startup_tab: "analysis" }); // async-result-ignored: 押しの取りこぼしを見る検査で、結果は使わない
        }}
      >
        startup
      </button>
      <button
        data-testid="gauge"
        onClick={() => {
          void setDisplayConfig({ show_evaluation_bar: true }); // async-result-ignored: 同上
        }}
      >
        gauge
      </button>
    </div>
  );
}

/** 設定が読めた直後の描画の `setLastPresetId` を掴んだまま呼ぶ。列の中で待つ呼び手と同じ形 */
function StalePresetProbe() {
  const { config, setLastPresetId } = useAppConfig();
  const captured = useRef<typeof setLastPresetId | null>(null);
  if (config && !captured.current) captured.current = setLastPresetId;
  return (
    <button
      data-testid="preset"
      onClick={() => {
        void captured.current?.("preset-1" as PresetId);
      }}
    >
      preset
    </button>
  );
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
    saveConfig.mockReset();
    setRootDirApi.mockReset();
    // **書いたものが読める小さなディスク。** 固定値を返す mock だと、
    // 土台を取り直す実装と握り続ける実装が同じ結果になり、検査が空回りする
    disk = { root_dir: "/old", ai_root: null };
    loadConfig.mockImplementation(async () => ({ ...disk }));
    saveConfig.mockImplementation(async (next: AppConfig) => {
      disk = { ...next };
    });
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
      expect(screen.getByTestId("error").textContent).toContain("設定を読み込めませんでした"),
    );

    fireEvent.click(screen.getByTestId("choose"));
    await waitFor(() => expect(loadingText()).toBe("false"));

    expect(screen.getByTestId("error").textContent).toContain("設定を読み込めませんでした");
    expect(screen.getByTestId("error").textContent).not.toContain(
      "ワークスペースを開けませんでした",
    );
  });

  /**
   * **書き込みの土台をレンダのクロージャから取らない。**
   *
   * `setDisplayConfig` は `loading` を立てないので、ディスクへの1往復が終わるまで
   * 再レンダが起きない。土台をクロージャから取ると、その間に来た2件目は必ず同じ
   * 古い土台を読み、`save_config` はファイルごと置き換えるので1件目の欄が消える。
   * 画面は成功扱いなので、押したチェックが黙って戻るだけになる。
   */
  it("保存が返る前に押した2件目が、1件目の欄を消さない", async () => {
    let release: () => void = () => {};
    const write = saveConfig.getMockImplementation()!;
    saveConfig.mockImplementation(
      (next: AppConfig) =>
        new Promise<void>((resolve) => {
          release = () => {
            void write(next);
            resolve();
          };
        }),
    );

    render(
      <AppConfigProvider>
        <DisplayProbe />
      </AppConfigProvider>,
    );
    await waitFor(() => expect(loadConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("startup"));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("gauge"));

    release();
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));

    expect(saveConfig.mock.calls[1][0]).toMatchObject({
      dock_startup_tab: "analysis",
      show_evaluation_bar: true,
    });
  });

  /**
   * **鎖に土台を持たせない。**
   *
   * `app.json` を書くのは表示の設定だけではない。自分が書いた値を鎖が握り続けると、
   * 間に挟まった別の書き手（ここでは `setRootDir`）の欄を次の書き込みが古い値へ戻す
   * —— ワークスペースを選び直した直後にチェックを1つ押すと、`root_dir` が
   * 消えたパスへ戻る。
   */
  it("間に別の書き手が挟まっても、その欄を書き戻さない", async () => {
    setRootDirApi.mockImplementation(async (next: string) => {
      disk = { ...disk, root_dir: next };
    });

    render(
      <AppConfigProvider>
        <DisplayProbe />
        <Probe />
      </AppConfigProvider>,
    );
    await waitFor(() => expect(loadConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("gauge"));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("set"));
    await waitFor(() => expect(disk.root_dir).toBe("/next"));

    fireEvent.click(screen.getByTestId("startup"));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));

    expect(disk.root_dir).toBe("/next");
    expect(disk.show_evaluation_bar).toBe(true);
    expect(disk.dock_startup_tab).toBe("analysis");
  });

  /**
   * 描画が持つ `config` を土台にすると、掴まれていた間に別の経路が書いた欄を
   * 古い値へ戻す。ファイルごと置き換えるので、表示の設定がまとめて巻き戻る
   */
  it("使うプリセットの保存が、描画より後に書かれた欄を書き戻さない", async () => {
    render(
      <AppConfigProvider>
        <DisplayProbe />
        <StalePresetProbe />
      </AppConfigProvider>,
    );
    await waitFor(() => expect(loadConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("preset")).toBeTruthy());
    await act(async () => {});

    fireEvent.click(screen.getByTestId("gauge"));
    await waitFor(() => expect(disk.show_evaluation_bar).toBe(true));

    fireEvent.click(screen.getByTestId("preset"));
    await waitFor(() => expect(disk.last_preset_id).toBe("preset-1"));

    expect(disk.show_evaluation_bar).toBe(true);
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

describe("成否の返し方", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <AppConfigProvider>{children}</AppConfigProvider>;
  }

  async function mounted() {
    const view = renderHook(() => useAppConfig(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    return view;
  }

  afterEach(cleanup);

  beforeEach(() => {
    loadConfig.mockReset();
    saveConfig.mockReset();
    setRootDirApi.mockReset();
    chooseRootDirApi.mockReset();
    chooseAiRootApi.mockReset();
    disk = { root_dir: "/old", ai_root: null };
    loadConfig.mockImplementation(async () => ({ ...disk }));
    saveConfig.mockImplementation(async (next: AppConfig) => {
      disk = { ...next };
    });
  });

  it("起動時に読めなければ error に積み、config は null のまま", async () => {
    loadConfig.mockRejectedValue("壊れている");
    const view = await mounted();

    expect(view.result.current.config).toBeNull();
    expect(view.result.current.error).toContain("壊れている");
  });

  it("ワークスペースを選べたら読み直して、選んだ先を返す", async () => {
    const view = await mounted();
    chooseRootDirApi.mockImplementation(async () => {
      disk = { ...disk, root_dir: "/picked" };
      return "/picked";
    });

    let picked: string | null = null;
    await act(async () => {
      picked = await view.result.current.chooseRootDir({ force: true });
    });

    expect(picked).toBe("/picked");
    expect(chooseRootDirApi).toHaveBeenCalledWith({ force: true });
    expect(view.result.current.config?.root_dir).toBe("/picked");
  });

  it("ワークスペースを選べなければ error に積み、null を返す", async () => {
    const view = await mounted();
    chooseRootDirApi.mockRejectedValue("書けない");

    let picked: string | null = "未設定";
    await act(async () => {
      picked = await view.result.current.chooseRootDir();
    });

    expect(picked).toBeNull();
    expect(view.result.current.error).toContain("書けない");
  });

  it("AI ライブラリを選べたら読み直して、選んだ先を Ok で返す", async () => {
    const view = await mounted();
    chooseAiRootApi.mockImplementation(async () => {
      disk = { ...disk, ai_root: "/ai" };
      return "/ai";
    });

    let result: unknown;
    await act(async () => {
      result = await view.result.current.chooseAiRoot({ force: true });
    });

    expect(result).toEqual({ success: true, data: "/ai" });
    expect(chooseAiRootApi).toHaveBeenCalledWith({ force: true });
    expect(view.result.current.config?.ai_root).toBe("/ai");
  });

  it("AI ライブラリの取り消しは Ok(null) で、読み直さない", async () => {
    const view = await mounted();
    chooseAiRootApi.mockResolvedValue(null);
    const reads = loadConfig.mock.calls.length;

    let result: unknown;
    await act(async () => {
      result = await view.result.current.chooseAiRoot();
    });

    expect(result).toEqual({ success: true, data: null });
    expect(loadConfig.mock.calls.length).toBe(reads);
  });

  it("AI ライブラリを選べなければ Err で返し、error に積まず、isLoading を降ろす", async () => {
    const view = await mounted();
    chooseAiRootApi.mockImplementation(async () => {
      await loadConfig();
      throw new Error("書けない");
    });

    let result: { success: boolean; error?: string } | undefined;
    await act(async () => {
      result = await view.result.current.chooseAiRoot();
    });

    expect(result?.success).toBe(false);
    expect(result?.error).toContain("書けない");
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.isLoading).toBe(false);
  });

  it("ワークスペースの差し替えが通れば読み直して Ok を返す", async () => {
    const view = await mounted();
    setRootDirApi.mockImplementation(async (next: string) => {
      disk = { ...disk, root_dir: next };
    });

    let result: unknown;
    await act(async () => {
      result = await view.result.current.setRootDir("/next");
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(view.result.current.config?.root_dir).toBe("/next");
  });

  it("使うプリセットを書けたら config へ載せる", async () => {
    const view = await mounted();

    await act(async () => {
      await view.result.current.setLastPresetId("preset-1" as PresetId);
    });

    expect(disk.last_preset_id).toBe("preset-1");
    expect(view.result.current.config?.last_preset_id).toBe("preset-1");
    expect(view.result.current.isLoading).toBe(false);
  });

  it("使うプリセットを書けなければ error に積む", async () => {
    const view = await mounted();
    saveConfig.mockRejectedValue("書けない");

    await act(async () => {
      await view.result.current.setLastPresetId("preset-1" as PresetId);
    });

    expect(view.result.current.error).toContain("書けない");
    expect(view.result.current.isLoading).toBe(false);
  });

  it("表示の設定を書けなければ Err を返し、次の書き込みは通る", async () => {
    const view = await mounted();
    saveConfig.mockRejectedValueOnce("書けない");

    let failed: { success: boolean; error?: string } | undefined;
    await act(async () => {
      failed = await view.result.current.setDisplayConfig({ show_evaluation_bar: true });
    });
    expect(failed?.success).toBe(false);
    expect(failed?.error).toContain("書けない");
    expect(view.result.current.error).toBeNull();

    let retried: unknown;
    await act(async () => {
      retried = await view.result.current.setDisplayConfig({ show_evaluation_bar: true });
    });
    expect(retried).toEqual({ success: true, data: undefined });
    expect(disk.show_evaluation_bar).toBe(true);
    expect(view.result.current.config?.show_evaluation_bar).toBe(true);
  });
});

describe("useAppConfig", () => {
  it("provider の外では投げる", () => {
    expect(() => renderHook(() => useAppConfig())).toThrow("AppConfigProvider");
  });
});
