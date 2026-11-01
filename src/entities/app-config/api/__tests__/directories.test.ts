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

const { chooseAiRoot, chooseRootDir, setRootDir } = await import("../directories");

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

describe("読めているときの選び直し", () => {
  beforeEach(() => {
    loadConfig.mockResolvedValue({ root_dir: "/w", ai_root: "/a", last_preset_id: "p" });
  });

  it("決まっていれば、force でない限りピッカーを開かず今の値を返す", async () => {
    await expect(chooseRootDir()).resolves.toBe("/w");
    await expect(chooseAiRoot()).resolves.toBe("/a");

    expect(pickDirectory).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("force なら選び直し、他の欄を保ったまま書く", async () => {
    await expect(chooseRootDir({ force: true })).resolves.toBe("/picked");
    expect(saveConfig).toHaveBeenLastCalledWith({
      root_dir: "/picked",
      ai_root: "/a",
      last_preset_id: "p",
    });

    await expect(chooseAiRoot({ force: true })).resolves.toBe("/picked");
    expect(saveConfig).toHaveBeenLastCalledWith({
      root_dir: "/w",
      ai_root: "/picked",
      last_preset_id: "p",
    });
  });

  it("欄ごとの言葉でピッカーを開く", async () => {
    await chooseRootDir({ force: true });
    expect(pickDirectory).toHaveBeenLastCalledWith("ワークスペースを選択してください");

    await chooseAiRoot({ force: true });
    expect(pickDirectory).toHaveBeenLastCalledWith("AI ライブラリを選択してください");
  });

  it("取り消しは null で、書かない", async () => {
    pickDirectory.mockResolvedValue(null);

    await expect(chooseRootDir({ force: true })).resolves.toBeNull();
    await expect(chooseAiRoot({ force: true })).resolves.toBeNull();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("空白だけのパスは断り、書かない", async () => {
    pickDirectory.mockResolvedValue("  ");

    await expect(chooseRootDir({ force: true })).rejects.toThrow("不正なワークスペースです");
    await expect(chooseAiRoot({ force: true })).rejects.toThrow("不正なAI ライブラリです");
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("ワークスペースの差し替えは他の欄を保って書き、空を断る", async () => {
    await setRootDir("/next");
    expect(saveConfig).toHaveBeenLastCalledWith({
      root_dir: "/next",
      ai_root: "/a",
      last_preset_id: "p",
    });

    await expect(setRootDir(" ")).rejects.toThrow("不正なワークスペースです");
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});

describe("保存の失敗", () => {
  it("退避に失敗しても、書き込みは続ける", async () => {
    loadConfig.mockRejectedValue(new Error("壊れている"));
    backupBrokenConfig.mockRejectedValue(new Error("退避できない"));

    await expect(setRootDir("/next")).resolves.toBeUndefined();
    expect(saveConfig).toHaveBeenCalledWith({ root_dir: "/next", ai_root: null });
  });

  it("書けなければ投げる", async () => {
    loadConfig.mockResolvedValue({ root_dir: null, ai_root: null });
    saveConfig.mockRejectedValue(new Error("書けない"));

    await expect(setRootDir("/next")).rejects.toThrow("書けない");
  });
});
