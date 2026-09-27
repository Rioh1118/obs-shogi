import { describe, expect, test } from "vitest";

import type { EngineCandidate } from "@/entities/engine/api/aiLibrary";
import { presetEngineOptions } from "../presetEngineOptions";

function candidate(entry: string): EngineCandidate {
  return { entry, path: `/ai/engines/${entry}`, kind: "file", launchability: "ready" };
}

describe("プリセット編集のエンジンの候補", () => {
  test("名前で絞らない。YaneuraOu 以外も、1段下のフォルダにあるものも選べる", () => {
    const options = presetEngineOptions([
      candidate("YaneuraOu_NNUE-V900Git_APPLEM1"),
      candidate("zermelo-f558898"),
      candidate("YaneuraOu-by-gcc"),
      candidate("suisho5/YaneuraOu-by-gcc"),
    ]);

    expect(options.map((o) => [o.label, o.disabled])).toEqual([
      ["YaneuraOu_NNUE-V900Git_APPLEM1", false],
      ["zermelo-f558898", false],
      ["YaneuraOu-by-gcc", false],
      ["suisho5/YaneuraOu-by-gcc", false],
    ]);
  });

  // 外すと、置いたのに出ないエンジンについて画面が何も言わない
  test("起動できない見込みのものも、理由を添えて並べる。別の OS 向けと読めないものは選べない", () => {
    const options = presetEngineOptions([
      { ...candidate("YaneuraOu_AVX2.exe"), launchability: "wrongPlatform" },
      { ...candidate("pkg/"), kind: "dir", launchability: "unreadable" },
      { ...candidate("noexec"), launchability: "notExecutable" },
      { ...candidate("downloaded"), launchability: "quarantined" },
    ]);

    expect(options.map((o) => [o.label, o.disabled])).toEqual([
      ["YaneuraOu_AVX2.exe（別の OS 向けです）", true],
      ["pkg/（読めません）", true],
      ["noexec（実行権限がありません）", false],
      ["downloaded（macOS がまだ開くのを許可していません）", false],
    ]);
  });

  test("ファイルでないものは選べない", () => {
    const [option] = presetEngineOptions([{ ...candidate("somedir"), kind: "dir" }]);

    expect(option.disabled).toBe(true);
  });
});
