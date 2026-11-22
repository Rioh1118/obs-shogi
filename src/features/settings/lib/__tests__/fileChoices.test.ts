import { describe, expect, test } from "vitest";

import type { ProfileCandidate } from "@/entities/ai-library/api/aiLibrary";
import { bookChoices, bookReadAsDb, evalChoices, fileLabel, isFileKind } from "../fileChoices";

const profile = (name: string, evals: string[], books: string[]): ProfileCandidate => ({
  name,
  path: `/ai/${name}`,
  has_eval_dir: evals.length > 0,
  has_book_dir: books.length > 0,
  eval_files: evals.map((e) => ({ entry: e, path: `/ai/${name}/eval/${e}`, kind: "file" })),
  eval_options: [],
  eval_options_outside_eval: false,
  book_files: books.map((b) => ({ entry: b, path: `/ai/${name}/book/${b}`, kind: "file" })),
});
const PROFILES = [
  profile("hao", ["x.bin", "nn.bin"], []),
  profile("li", ["nn.bin"], ["user_book1.db"]),
];

describe("isFileKind", () => {
  test("ファイルとリンクは開ける。フォルダと種類の分からないものは開けない", () => {
    expect(isFileKind("file")).toBe(true);
    expect(isFileKind("symlink")).toBe(true);
    expect(isFileKind("dir")).toBe(false);
    expect(isFileKind("unknown")).toBe(false);
  });
});

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

  // R-B4: やねうら王は `.ybb` を `.db` の名前で受け、同じ名前の `.db` があればそちらを読む
  const AOBA = profile("aoba", [], ["user_book1.db", "User_Book1.YBB", "other.ybb"]);

  test("同じ名前の .db と並ぶ .ybb にだけ、.db が読まれると添える（名前の大小は区別しない）", () => {
    expect(bookChoices([AOBA], null).map((c) => c.label)).toEqual([
      "使わない",
      "aoba / user_book1.db",
      "aoba / User_Book1.YBB（.db が読まれる）",
      "aoba / other.ybb",
    ]);
  });

  test("案内を出すのは、同じ名前の .db に読み替えられる .ybb を選んだときだけ", () => {
    expect(bookReadAsDb([AOBA], "/ai/aoba/book/User_Book1.YBB")).toBe(true);
    expect(bookReadAsDb([AOBA], "/ai/aoba/book/other.ybb")).toBe(false);
    expect(bookReadAsDb([AOBA], "/ai/aoba/book/user_book1.db")).toBe(false);
    expect(bookReadAsDb([AOBA], null)).toBe(false);
    // 別のフォルダの同じ名前の .db は読まれない
    const split = [profile("a", [], ["user_book1.db"]), profile("b", [], ["user_book1.ybb"])];
    expect(bookReadAsDb(split, "/ai/b/book/user_book1.ybb")).toBe(false);
  });
});
