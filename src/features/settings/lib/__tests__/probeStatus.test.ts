import { describe, expect, test } from "vitest";

import { probeStatusText } from "../probeStatus";

const BASE = { enginePath: "/e/a", definitions: null, definitionsFor: null, engineName: null };
const PROBED = {
  ...BASE,
  definitions: [{ name: "Threads", type: "spin" as const, default: 4, min: 1, max: 8 }],
  definitionsFor: "/e/a",
  engineName: "A",
};

describe("probeStatusText", () => {
  test("エンジンが空なら出さない", () => {
    expect(probeStatusText({ ...BASE, enginePath: "" }, false, null)).toBeNull();
  });

  test("取ったエンジンの定義なら件数と名前", () => {
    expect(probeStatusText(PROBED, false, null)).toBe("オプション 1 件を取得済み（A）");
  });

  // 選び直すと前のエンジンの定義が下書きに残る。件数だけを見ると別のエンジンの定義を言う
  test("別のエンジンの定義は未取得として扱う", () => {
    expect(probeStatusText({ ...PROBED, enginePath: "/e/b" }, false, null)).toBe(
      "オプションは未取得です",
    );
  });

  test("取得中と失敗", () => {
    expect(probeStatusText(PROBED, true, null)).toBe("オプションを取得中…");
    expect(probeStatusText(PROBED, false, "quarantined")).toContain("macOS");
    expect(probeStatusText(BASE, false, "cancelled")).toBe("オプションは未取得です");
  });
});
