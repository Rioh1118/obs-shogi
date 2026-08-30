import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `save_config` はファイルごと置き換える。読めなかった設定の上に組み立てた値を
 * 書くと、**読めていない欄が `null` で書き潰される**。
 *
 * 壊れた `app.json` でも、中の文字列は利用者が選んだ場所そのもの。
 * 捨てる前に取っておく。
 */

const loadConfig = vi.fn();
const saveConfig = vi.fn();
const backupBrokenConfig = vi.fn();
const pickDirectory = vi.fn();

vi.mock("../config", () => ({
  loadConfig: (...a: unknown[]) => loadConfig(...a),
  saveConfig: (...a: unknown[]) => saveConfig(...a),
  backupBrokenConfig: (...a: unknown[]) => backupBrokenConfig(...a),
}));

vi.mock("@/shared/api/picker/pickDirectory", () => ({
  pickDirectory: (...a: unknown[]) => pickDirectory(...a),
}));

const { chooseAiRoot, chooseRootDir } = await import("../directories");

beforeEach(() => {
  vi.clearAllMocks();
  saveConfig.mockResolvedValue(undefined);
  backupBrokenConfig.mockResolvedValue("/cfg/app.json.broken");
  pickDirectory.mockResolvedValue("/picked");
});

describe("設定を読めないときの選び直し", () => {
  it("ピッカーは開く。読めない設定に依存して出口を塞がない", async () => {
    loadConfig.mockRejectedValue(new Error("expected value at line 1 column 1"));

    await expect(chooseRootDir({ force: true })).resolves.toBe("/picked");
    expect(pickDirectory).toHaveBeenCalledTimes(1);
  });

  it("上書きの前に、読めなかった設定を退避する", async () => {
    loadConfig.mockRejectedValue(new Error("broken"));

    await chooseRootDir({ force: true });

    expect(backupBrokenConfig).toHaveBeenCalledTimes(1);
    // 退避が先。逆だと、置き換えたあとのファイルを退避することになる
    expect(backupBrokenConfig.mock.invocationCallOrder[0]).toBeLessThan(
      saveConfig.mock.invocationCallOrder[0],
    );
  });

  it("読めているときは退避しない", async () => {
    loadConfig.mockResolvedValue({ root_dir: "/old", ai_root: "/ai" });

    await chooseRootDir({ force: true });

    expect(backupBrokenConfig).not.toHaveBeenCalled();
    // 読めた欄は持ち越す
    expect(saveConfig).toHaveBeenCalledWith({ root_dir: "/picked", ai_root: "/ai" });
  });

  /**
   * AI フォルダを選び直しただけでワークスペースが消える、という形で次の起動に出る。
   * 利用者から見て、2つの操作は結び付かない
   */
  it("AI フォルダの選び直しでも、読めなかった設定を退避してから書く", async () => {
    loadConfig.mockRejectedValue(new Error("broken"));

    await chooseAiRoot({ force: true });

    expect(backupBrokenConfig).toHaveBeenCalledTimes(1);
  });
});
