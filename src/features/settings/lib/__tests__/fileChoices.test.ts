import { describe, expect, test } from "vitest";

import type { ProfileCandidate } from "@/entities/engine/api/aiLibrary";
import { bookChoices, evalChoices, fileLabel } from "../fileChoices";

const profile = (name: string, evals: string[], books: string[]): ProfileCandidate => ({
  name,
  path: `/ai/${name}`,
  has_eval_dir: evals.length > 0,
  has_book_dir: books.length > 0,
  eval_files: evals.map((e) => ({ entry: e, path: `/ai/${name}/eval/${e}`, kind: "file" })),
  book_db_files: books.map((b) => ({ entry: b, path: `/ai/${name}/book/${b}`, kind: "file" })),
});
const PROFILES = [
  profile("hao", ["x.bin", "nn.bin"], []),
  profile("li", ["nn.bin"], ["user_book1.db"]),
];

describe("fileLabel", () => {
  test("AI ライブラリの形なら「フォルダ / ファイル」、そうでなければファイル名", () => {
    expect(fileLabel("/ai/hao/eval/nn.bin")).toBe("hao / nn.bin");
    expect(fileLabel("/ai/li/book/user_book1.db")).toBe("li / user_book1.db");
    expect(fileLabel("/elsewhere/model.bin")).toBe("model.bin");
  });
});

describe("evalChoices", () => {
  test("先頭は「指定しない」、フォルダごとに nn.bin を先に", () => {
    expect(evalChoices(PROFILES, "").map((c) => c.label)).toEqual([
      "指定しない",
      "hao / nn.bin",
      "hao / x.bin",
      "li / nn.bin",
    ]);
  });

  test("選んだフォルダの名前を持つ", () => {
    expect(evalChoices(PROFILES, "").find((c) => c.label === "li / nn.bin")?.folder).toBe("li");
  });

  test("選択肢に無い保存済みのパスも残す", () => {
    expect(evalChoices(PROFILES, "/gone/eval/old.bin")[1].label).toBe(
      "gone / old.bin（現在の選択）",
    );
  });
});

describe("bookChoices", () => {
  test("先頭は「使わない」、定跡の無いフォルダは出ない", () => {
    expect(bookChoices(PROFILES, null).map((c) => c.label)).toEqual([
      "使わない",
      "li / user_book1.db",
    ]);
  });
});
