import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { cloneJkf } from "../cloneJkf";

describe("cloneJkf", () => {
  test("変化の中まで別の配列になる", () => {
    const jkf: JKFData = {
      header: {},
      moves: [{}, { comments: ["a"], forks: [[{ comments: ["x"] }]] }],
    };
    const copy = cloneJkf(jkf);

    copy.moves[1].forks![0][0].comments = ["y"];
    copy.moves[1].comments!.push("b");

    expect(jkf.moves[1].forks![0][0].comments).toEqual(["x"]);
    expect(jkf.moves[1].comments).toEqual(["a"]);
  });

  test("値が undefined のキーも残る", () => {
    // JSON 経由の複製だとキーごと落ちる。`sanitizeJkfMoves` が `forks: undefined` を
    // 作るので、複製の書き方でキーの有無が変わらないことを固定しておく。
    const moves: JKFMove[] = [{ comments: ["a"], forks: undefined }];
    const copy = cloneJkf(moves);

    expect("forks" in copy[0]).toBe(true);
  });
});
