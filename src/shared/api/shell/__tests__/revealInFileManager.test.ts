import { beforeEach, describe, expect, it, vi } from "vitest";

import { revealInFileManager } from "../revealInFileManager";

const revealItemInDir = vi.fn<(path: string) => Promise<void>>();
const openPath = vi.fn<(path: string) => Promise<void>>();

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (path: string) => revealItemInDir(path),
  openPath: (path: string) => openPath(path),
}));

beforeEach(() => {
  revealItemInDir.mockReset().mockResolvedValue(undefined);
  openPath.mockReset().mockResolvedValue(undefined);
});

describe("revealInFileManager", () => {
  /**
   * `open_path` は capability が許していない（許すなら、既定のアプリで何を起動して
   * よいかを scope で決めることになる）。どちらの口を叩いているかが、
   * 効くボタンと効かないボタンを分ける
   */
  it("`reveal_item_in_dir` の口を叩く", async () => {
    const revealed = await revealInFileManager("/Users/me/ai");

    expect(revealItemInDir).toHaveBeenCalledWith("/Users/me/ai");
    expect(openPath).not.toHaveBeenCalled();
    expect(revealed.success).toBe(true);
  });

  // Tauri の reject は文字列で返る。この経路で実際に来るのはこちら
  it("失敗の理由を呼び出し元へ返す", async () => {
    revealItemInDir.mockRejectedValue("No such file or directory (os error 2)");

    const revealed = await revealInFileManager("/Users/me/ai");

    expect(revealed).toEqual({ success: false, error: "No such file or directory (os error 2)" });
  });

  // `Error` が投げられた回でも `message` を落とさない（`e instanceof Error` の枝）
  it("例外で落ちても理由が残る", async () => {
    revealItemInDir.mockRejectedValue(new Error("boom"));

    const revealed = await revealInFileManager("/Users/me/ai");

    expect(revealed).toEqual({ success: false, error: "boom" });
  });

  // 契約は `revealInFileManager` の doc にある
  it("空のパスでは何も叩かず、失敗にもしない", async () => {
    const revealed = await revealInFileManager("   ");

    expect(revealItemInDir).not.toHaveBeenCalled();
    expect(revealed.success).toBe(true);
  });
});
