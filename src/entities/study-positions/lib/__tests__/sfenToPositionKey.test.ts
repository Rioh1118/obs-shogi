import { describe, expect, it } from "vitest";

import { sfenToPositionKey } from "../sfenToPositionKey";

describe("sfenToPositionKey", () => {
  it("手数を落とす", () => {
    expect(sfenToPositionKey("9/9/9/9/9/9/9/9/9 b - 1")).toBe("9/9/9/9/9/9/9/9/9 b -");
    expect(sfenToPositionKey("9/9/9/9/9/9/9/9/9 b - 57")).toBe("9/9/9/9/9/9/9/9/9 b -");
  });

  it("前後の空白と続いた空白を無視する", () => {
    expect(sfenToPositionKey("  9/9/9/9/9/9/9/9/9   w   2P  3 ")).toBe("9/9/9/9/9/9/9/9/9 w 2P");
  });

  it("4語に満たない綴りは空文字を返す", () => {
    expect(sfenToPositionKey("9/9/9/9/9/9/9/9/9 b -")).toBe("");
    expect(sfenToPositionKey("")).toBe("");
  });
});
