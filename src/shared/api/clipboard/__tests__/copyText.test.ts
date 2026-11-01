// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../copyText";

const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(command: string) => boolean>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand.mockReset().mockReturnValue(true);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  document.execCommand = execCommand as unknown as typeof document.execCommand;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("クリップボードへ前後の空白を落として書く", async () => {
    await copyText("  /path  ");
    expect(writeText).toHaveBeenCalledWith("/path");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("空なら書かない", async () => {
    await copyText("   ");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("クリップボードの API が拒んだら、選択を写す経路へ落ちる", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await copyText("/path");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
