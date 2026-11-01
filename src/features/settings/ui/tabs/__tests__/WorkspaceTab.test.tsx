// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { ManualCheckResult, UpdaterStatus } from "@/entities/updater";
import type { IndexUiState } from "@/entities/search";

/**
 * 設定「ワークスペース」タブの3つの節。
 * 索引の具合の語、保存場所を変える手順、確認の結果が画面に出ることを見る。
 */

type Warn = { kind: "place" | "file"; path: string; message: string };

const world = vi.hoisted(() => ({
  appConfig: {
    config: { root_dir: "/ws" },
    isLoading: false,
    error: null as string | null,
    chooseRootDir: vi.fn<(opts?: { force?: boolean }) => Promise<string | null>>(),
  },
  search: {
    index: null as unknown,
    warns: [] as unknown[],
    clearWarns: vi.fn(),
  },
  updater: {
    status: { phase: "idle" } as unknown,
    persisted: null as { skippedVersion: string | null; lastCheckedMs: number | null } | null,
    manualCheck: null as unknown,
    isChecking: false,
    checkNow: vi.fn(async () => {}),
    unskip: vi.fn(async () => {}),
  },
  getAppVersion: vi.fn<() => Promise<string>>(),
  copyText: vi.fn(async () => {}),
}));

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  return {
    ...actual,
    useAppConfig: () => world.appConfig as unknown as ReturnType<typeof actual.useAppConfig>,
  } satisfies typeof import("@/entities/app-config");
});

vi.mock("@/entities/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/search")>();
  return {
    ...actual,
    usePositionSearch: () =>
      ({
        state: { index: world.search.index, warns: world.search.warns },
        clearWarns: world.search.clearWarns,
      }) as unknown as ReturnType<typeof actual.usePositionSearch>,
  } satisfies typeof import("@/entities/search");
});

vi.mock("@/entities/updater", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/updater")>();
  return {
    ...actual,
    useUpdater: () => world.updater as unknown as ReturnType<typeof actual.useUpdater>,
  } satisfies typeof import("@/entities/updater");
});

vi.mock(
  "@/shared/api/app/appVersion",
  () =>
    ({
      getAppVersion: world.getAppVersion,
    }) satisfies typeof import("@/shared/api/app/appVersion"),
);

const { default: WorkspaceTab } = await import("../WorkspaceTab");

const READY: IndexUiState = {
  state: "Ready",
  dirtyCount: 2,
  scanFailed: false,
  partiallyUnreadable: false,
  indexedFiles: 1200,
  totalFiles: 1300,
  doneFiles: 0,
  currentPath: null,
};

const clipboardWrite = vi.fn<(text: string) => Promise<void>>();
const reload = vi.fn();

/** 版の取得は effect で走るので、解決まで待ってから読む */
async function renderTab() {
  const view = render(<WorkspaceTab />);
  await act(async () => {});
  return view;
}

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

/** 見出しに対応する値の文字列 */
function valueOf(container: HTMLElement, label: string) {
  const key = within(container).getByText(label);
  return key.parentElement?.querySelector(".wsTab__miniV")?.textContent;
}

function warn(n: number, kind: Warn["kind"] = "file"): Warn {
  return { kind, path: `/ws/${n}.kif`, message: `読めません${n}` };
}

beforeEach(() => {
  world.appConfig.config = { root_dir: "/ws" };
  world.appConfig.isLoading = false;
  world.appConfig.error = null;
  world.appConfig.chooseRootDir.mockReset().mockResolvedValue(null);
  world.search.index = READY;
  world.search.warns = [];
  world.search.clearWarns.mockReset();
  world.updater.status = { phase: "idle" } satisfies UpdaterStatus;
  world.updater.persisted = { skippedVersion: null, lastCheckedMs: null };
  world.updater.manualCheck = null;
  world.updater.isChecking = false;
  world.updater.checkNow.mockClear();
  world.updater.unskip.mockClear();
  world.getAppVersion.mockReset().mockResolvedValue("1.2.3");
  clipboardWrite.mockReset().mockResolvedValue(undefined);
  reload.mockReset();
  vi.stubGlobal("navigator", { clipboard: { writeText: clipboardWrite } });
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("「状態」の節", () => {
  test.each<[string, Partial<IndexUiState>, string]>([
    ["作成済み", {}, "準備完了"],
    ["未作成", { state: "Empty" }, "未作成"],
    ["復元中", { state: "Restoring" }, "復元中"],
    ["作成中", { state: "Building" }, "作成中"],
    ["更新中", { state: "Updating" }, "更新中"],
    ["走査の失敗", { scanFailed: true }, "更新できていません"],
    ["読めない場所", { partiallyUnreadable: true }, "一部を読めていません"],
    ["入れられない棋譜", { indexedFiles: 0, totalFiles: 3 }, "一部を索引に入れられていません"],
  ])("バッジは具合の語を出す: %s", async (_name, patch, label) => {
    world.search.index = { ...READY, indexedFiles: READY.totalFiles, ...patch };

    const { container } = await renderTab();

    expect(container.querySelector(".sbadge")?.textContent).toBe(label);
  });

  test("数を区切りつきで出す", async () => {
    const { container } = await renderTab();

    expect(valueOf(container, "対象ファイル")).toBe("1,300");
    expect(valueOf(container, "未同期")).toBe("2");
    expect(valueOf(container, "索引済み")).toBe("1,200 / 1,300");
    expect(valueOf(container, "警告")).toBe("0");
  });

  test("走査に失敗したら未同期を 0 と書かない", async () => {
    world.search.index = { ...READY, dirtyCount: 0, scanFailed: true };
    const { container } = await renderTab();

    expect(valueOf(container, "未同期")).toBe("確認できていません");
  });

  test("進捗バーは作業中で分母があるときだけ出す", async () => {
    const { container, rerender } = await renderTab();
    expect(container.querySelector(".wsTab__progress")).toBeNull();

    world.search.index = { ...READY, state: "Building", totalFiles: 0 };
    rerender(<WorkspaceTab />);
    expect(container.querySelector(".wsTab__progress")).toBeNull();

    world.search.index = {
      ...READY,
      state: "Building",
      totalFiles: 200,
      doneFiles: 50,
      currentPath: "/ws/a.kif",
    };
    rerender(<WorkspaceTab />);

    expect(container.querySelector(".wsTab__progressLeft")?.textContent).toBe("50 / 200 files25%");
    expect(container.querySelector(".wsTab__progressPath")?.textContent).toBe("/ws/a.kif");
    expect(container.querySelector<HTMLElement>(".wsTab__barFill")?.style.width).toBe("25%");
  });

  test("更新中の分母は未同期の数で、対象ファイルの数ではない", async () => {
    world.search.index = { ...READY, state: "Updating", dirtyCount: 4, doneFiles: 1 };
    const { container } = await renderTab();

    expect(container.querySelector(".wsTab__progressLeft")?.textContent).toBe("1 / 4 files25%");
    expect(container.querySelector(".wsTab__progressPath")).toBeNull();
  });

  test("進捗は 0 から 100 に収める", async () => {
    world.search.index = { ...READY, state: "Building", totalFiles: 10, doneFiles: 30 };
    const { container } = await renderTab();

    expect(container.querySelector(".wsTab__pct")?.textContent).toBe("100%");
  });

  test("警告が無ければ一覧もクリアのボタンも出さない", async () => {
    const { container } = await renderTab();

    expect(container.querySelector(".wsTab__warnBox")).toBeNull();
    expect(screen.queryByRole("button", { name: "警告をクリア" })).toBeNull();
  });

  test("警告は5件まで、場所を先に出し、切った数を言う", async () => {
    world.search.warns = [1, 2, 3, 4, 5, 6].map((n) => warn(n)).concat(warn(7, "place"));
    const { container } = await renderTab();

    const paths = [...container.querySelectorAll(".wsTab__warnPath")].map((p) => p.textContent);
    expect(paths).toHaveLength(5);
    expect(paths[0]).toBe("/ws/7.kif");
    expect(container.querySelector(".wsTab__warnMore")?.textContent).toBe(
      "ほか 2 件（読めなかった場所を先に、5 件だけ表示しています）",
    );
    expect(valueOf(container, "警告")).toBe("7");
  });

  test("全部出せたら切った数を言わない", async () => {
    world.search.warns = [warn(1)];
    const { container } = await renderTab();

    expect(container.querySelector(".wsTab__warnMore")).toBeNull();
    expect(container.querySelector(".wsTab__warnMsg")?.textContent).toBe("読めません1");
  });

  test("「警告をクリア」は警告を消す", async () => {
    world.search.warns = [warn(1)];
    await renderTab();

    fireEvent.click(screen.getByRole("button", { name: "警告をクリア" }));

    expect(world.search.clearWarns).toHaveBeenCalledTimes(1);
  });

  test("設定の失敗をこの節の中に出す", async () => {
    world.appConfig.error = "設定を更新できませんでした";
    await renderTab();

    expect(section("状態").getByRole("alert").textContent).toBe("設定を更新できませんでした");
  });
});

describe("「保存場所」の節", () => {
  const change = () => screen.getByRole("button", { name: "変更して再読み込み" });
  const openConfirm = () =>
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを変更…" }));
  const typeConfirm = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText("CHANGE"), { target: { value } });

  test("コピーは保存場所のパスを書く", async () => {
    await renderTab();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "コピー" }));
    });

    expect(clipboardWrite).toHaveBeenCalledWith("/ws");
  });

  test("読み込み中はコピーできない", async () => {
    world.appConfig.isLoading = true;
    await renderTab();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "コピー" }).disabled).toBe(true);
  });

  test("押すまで確認の欄を出さない", async () => {
    await renderTab();

    expect(screen.queryByPlaceholderText("CHANGE")).toBeNull();
  });

  test.each([
    ["", false],
    ["chang", false],
    ["CHANGE", true],
    [" change ", true],
  ])("「%s」と打つと実行は %s", async (text, enabled) => {
    await renderTab();
    openConfirm();

    typeConfirm(text);

    expect((change() as HTMLButtonElement).disabled).toBe(!enabled);
  });

  test("キャンセルで欄を閉じ、打った文字は次に開いたときも残る", async () => {
    await renderTab();
    openConfirm();
    typeConfirm("CHANGE");

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByPlaceholderText("CHANGE")).toBeNull();

    openConfirm();
    expect(screen.getByPlaceholderText<HTMLInputElement>("CHANGE").value).toBe("CHANGE");
  });

  test("選んだらアプリを読み直す", async () => {
    world.appConfig.chooseRootDir.mockResolvedValue("/next");
    await renderTab();
    openConfirm();
    typeConfirm("CHANGE");

    await act(async () => {
      fireEvent.click(change());
    });

    expect(world.appConfig.chooseRootDir).toHaveBeenCalledWith({ force: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("選ばなければ読み直さない", async () => {
    await renderTab();
    openConfirm();
    typeConfirm("CHANGE");

    await act(async () => {
      fireEvent.click(change());
    });

    expect(world.appConfig.chooseRootDir).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("「更新」の節", () => {
  const check = () => screen.getByRole<HTMLButtonElement>("button", { name: "更新を確認" });

  test("版が取れれば出す", async () => {
    const { container } = await renderTab();

    expect(valueOf(container, "現在のバージョン")).toBe("1.2.3");
  });

  test("版が取れなければ「—」のまま", async () => {
    world.getAppVersion.mockRejectedValue(new Error("no"));
    const { container } = await renderTab();

    expect(valueOf(container, "現在のバージョン")).toBe("—");
  });

  test("一度も確認できていなければそう書く", async () => {
    const { container } = await renderTab();

    expect(valueOf(container, "最後に確認できた")).toBe("まだ確認できていません");
  });

  test("記憶をまだ読めていなくても同じ", async () => {
    world.updater.persisted = null;
    const { container } = await renderTab();

    expect(valueOf(container, "最後に確認できた")).toBe("まだ確認できていません");
  });

  test("確認できた時刻を日本語の形で出す", async () => {
    const ms = new Date(2026, 10, 1, 9, 5).getTime();
    world.updater.persisted = { skippedVersion: null, lastCheckedMs: ms };
    const { container } = await renderTab();

    expect(valueOf(container, "最後に確認できた")).toBe("2026/11/01 09:05");
  });

  test("押すと確認する。確認中は押せない", async () => {
    const { rerender } = await renderTab();

    fireEvent.click(check());
    expect(world.updater.checkNow).toHaveBeenCalledTimes(1);

    world.updater.isChecking = true;
    rerender(<WorkspaceTab />);
    expect(check().disabled).toBe(true);
  });

  test("押していなければ結果を出さない", async () => {
    await renderTab();

    expect(section("更新").queryByRole("status")).toBeNull();
  });

  test.each<[ManualCheckResult, string]>([
    [{ kind: "upToDate" }, "最新版を使っています"],
    [
      { kind: "found", version: "2.0.0" },
      "新しいバージョン v2.0.0 が公開されています。この画面を閉じると案内が出ます。",
    ],
    [
      { kind: "foundButSkipped", version: "2.0.0" },
      "新しいバージョン v2.0.0 がありますが、この版は飛ばす設定になっています。",
    ],
    [{ kind: "failed" }, "更新を確認できませんでした。通信を確認して、もう一度お試しください。"],
  ])("確認の結果を出す: %o", async (result, text) => {
    world.updater.manualCheck = result;
    await renderTab();

    expect(section("更新").getByRole("status").textContent).toBe(text);
  });

  test("飛ばしている版を出し、解除できる", async () => {
    world.updater.persisted = { skippedVersion: "2.0.0", lastCheckedMs: null };
    await renderTab();

    expect(screen.getByText("v2.0.0 を飛ばす設定になっています")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "解除" }));

    expect(world.updater.unskip).toHaveBeenCalledTimes(1);
  });

  test("飛ばしていなければ解除を出さない", async () => {
    await renderTab();

    expect(screen.queryByRole("button", { name: "解除" })).toBeNull();
  });
});
