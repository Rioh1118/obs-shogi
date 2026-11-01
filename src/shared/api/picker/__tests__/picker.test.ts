import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickBookFile } from "../pickBookFile";
import { pickDirectory } from "../pickDirectory";
import { pickFile } from "../pickFile";

const dialogOpen = vi.fn<(options: unknown) => Promise<string | string[] | null>>();

vi.mock("@tauri-apps/plugin-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/plugin-dialog")>();
  return {
    ...actual,
    open: ((options: unknown) => dialogOpen(options)) as never,
  } satisfies typeof import("@tauri-apps/plugin-dialog");
});

beforeEach(() => {
  dialogOpen.mockReset().mockResolvedValue("/picked");
});

describe.each([
  ["pickDirectory", () => pickDirectory("題")],
  ["pickFile", () => pickFile("題")],
  ["pickBookFile", () => pickBookFile()],
])("%s が返すパス", (_name, pick) => {
  it("選ばれたパスを返す", async () => {
    await expect(pick()).resolves.toBe("/picked");
  });

  it("取り消したら null を返す", async () => {
    dialogOpen.mockResolvedValue(null);
    await expect(pick()).resolves.toBeNull();
  });

  it("配列で返っても先頭の1つを返す", async () => {
    dialogOpen.mockResolvedValue(["/first", "/second"]);
    await expect(pick()).resolves.toBe("/first");
  });

  it("空の配列は取り消しと同じに読む", async () => {
    dialogOpen.mockResolvedValue([]);
    await expect(pick()).resolves.toBeNull();
  });

  it("1つだけ選ばせる", async () => {
    await pick();
    expect(dialogOpen.mock.calls[0][0]).toMatchObject({ multiple: false });
  });
});

describe("ダイアログへ渡す条件", () => {
  it("pickDirectory はフォルダを選ばせる", async () => {
    await pickDirectory("題");
    expect(dialogOpen).toHaveBeenCalledWith({ directory: true, multiple: false, title: "題" });
  });

  it("pickFile はファイルを絞らずに選ばせる", async () => {
    await pickFile("題");
    expect(dialogOpen).toHaveBeenCalledWith({ directory: false, multiple: false, title: "題" });
  });

  it("pickBookFile は定跡の4拡張子で絞る", async () => {
    await pickBookFile();
    expect(dialogOpen).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      title: "定跡ファイルを選択してください",
      filters: [{ name: "定跡", extensions: ["db", "bin", "sbk", "ybb"] }],
    });
  });
});
