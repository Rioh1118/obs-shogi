import { describe, expect, test } from "vitest";

import { fitNoteLines, type FitNote } from "../fitNote";

const NOTE: FitNote = {
  enginePath: "/e/a",
  dropped: [{ name: "NetworkDelay", value: "120", reason: "notDeclared" }],
  clamped: [{ name: "Threads", value: "512" }],
};

describe("fitNoteLines", () => {
  test("外した値と丸めた値を1件1行で言う", () => {
    expect(fitNoteLines(NOTE, "/e/a")).toEqual([
      "NetworkDelay = 120 を外しました（このエンジンに無い）",
      "Threads を 512 に丸めました（範囲の外）",
    ]);
  });

  test("選び直した後は、前のエンジンで変えた値を言わない", () => {
    expect(fitNoteLines(NOTE, "/e/b")).toEqual([]);
    expect(fitNoteLines(null, "/e/a")).toEqual([]);
  });
});
