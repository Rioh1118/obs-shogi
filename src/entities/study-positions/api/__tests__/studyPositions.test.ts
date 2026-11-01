import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke } satisfies typeof import("@tauri-apps/api/core");
});

const { loadStudyPositions, saveStudyPositions } = await import("../studyPositions");

/** コマンドの名前と引数の鍵は Rust の `#[tauri::command]` と揃っていなければ届かない */
describe("課題局面のコマンド", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("読むときは load_study_positions を呼び、応答をそのまま返す", async () => {
    invoke.mockResolvedValue({ positions: [] });

    await expect(loadStudyPositions()).resolves.toEqual({ positions: [] });
    expect(invoke).toHaveBeenCalledWith("load_study_positions");
  });

  it("書くときは input の鍵で渡す", async () => {
    invoke.mockResolvedValue(null);

    await saveStudyPositions({ positions: [] });
    expect(invoke).toHaveBeenCalledWith("save_study_positions", { input: { positions: [] } });
  });
});
