import { describe, expect, test } from "vitest";

import type { EngineCandidate } from "@/entities/engine/api/aiLibrary";
import { presetEngineCandidates } from "../engineFilter";

function candidate(entry: string): EngineCandidate {
  return { entry, path: `/ai/engines/${entry}`, kind: "file", launchability: "ready" };
}

describe("プリセット編集で選べるエンジン", () => {
  test("engines/ の直下で、名前が YaneuraOu_ で始まるものだけ", () => {
    const listed = presetEngineCandidates([
      candidate("YaneuraOu_NNUE-V900Git_APPLEM1"),
      candidate("zermelo-f558898"),
      candidate("YaneuraOu-by-gcc"),
    ]);

    expect(listed.map((e) => e.entry)).toEqual(["YaneuraOu_NNUE-V900Git_APPLEM1"]);
  });

  // フォルダ名が YaneuraOu_ で始まっていても、中のエンジンは作業フォルダと評価関数の
  // 渡し方がまだ合わないので出さない。entry の先頭だけを見るとここを素通りする
  test("1段下のフォルダにあるものは、フォルダ名に関係なく出さない", () => {
    const listed = presetEngineCandidates([
      candidate("YaneuraOu_NNUE-V900_mac/YaneuraOu-by-gcc"),
      candidate("suisho5/YaneuraOu_NNUE-V900"),
      candidate("YaneuraOu_pkg/"),
    ]);

    expect(listed).toEqual([]);
  });
});
