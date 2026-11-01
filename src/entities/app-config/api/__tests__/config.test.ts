import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke } satisfies typeof import("@tauri-apps/api/core");
});

const { backupBrokenConfig, loadConfig, saveConfig } = await import("../config");

/** コマンドの名前と引数の鍵は Rust の `#[tauri::command]` と揃っていなければ届かない */
describe("設定のコマンド", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("読むときは load_config を呼び、応答をそのまま返す", async () => {
    const config = { root_dir: "/w", ai_root: null };
    invoke.mockResolvedValue(config);

    await expect(loadConfig()).resolves.toBe(config);
    expect(invoke).toHaveBeenCalledWith("load_config");
  });

  it("書くときは config の鍵で渡す", async () => {
    const config = { root_dir: "/w", ai_root: null };
    invoke.mockResolvedValue(null);

    await saveConfig(config);
    expect(invoke).toHaveBeenCalledWith("save_config", { config });
  });

  it("退避は退避先を返し、元のファイルが無ければ null を返す", async () => {
    invoke.mockResolvedValueOnce("/c/app.json.broken");
    await expect(backupBrokenConfig()).resolves.toBe("/c/app.json.broken");

    invoke.mockResolvedValueOnce(null);
    await expect(backupBrokenConfig()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("backup_broken_config");
  });
});
