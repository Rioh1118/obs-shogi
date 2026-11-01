import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke } satisfies typeof import("@tauri-apps/api/core");
});

const { loadUpdaterState, saveUpdaterState } = await import("../updaterState");

/** コマンドの名前と引数の鍵は Rust の `#[tauri::command]` と揃っていなければ届かない */
describe("更新の記憶のコマンド", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("読むときは load_updater_state を呼び、応答をそのまま返す", async () => {
    const state = { skippedVersion: "1.2.3", lastCheckedMs: 5 };
    invoke.mockResolvedValue(state);

    await expect(loadUpdaterState()).resolves.toBe(state);
    expect(invoke).toHaveBeenCalledWith("load_updater_state");
  });

  it("書くときは state の鍵で渡す", async () => {
    const state = { skippedVersion: null, lastCheckedMs: null };
    invoke.mockResolvedValue(null);

    await saveUpdaterState(state);
    expect(invoke).toHaveBeenCalledWith("save_updater_state", { state });
  });
});
