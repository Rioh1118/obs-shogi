import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./walk";

/**
 * skill が手順書として読み切れる長さに収まっていること。
 *
 * 書き足しだけを続けると指示どうしがぶつかり、どれかが守られなくなる。
 * 上限に当たったら数字を上げず、`/skill-care` の手順で圧縮する。
 * 説明文は呼ばれる前から毎回読まれるので、本文より厳しく見る。
 */
const MAX_LINES = 200;
const MAX_DESCRIPTION_CHARS = 200;

/** 走査が空振りして「0件」になったことを「違反が無い」と読ませないための下限 */
const MIN_SKILLS = 10;

const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");

function skills(): { name: string; text: string }[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      text: readFileSync(join(SKILLS_DIR, entry.name, "SKILL.md"), "utf8"),
    }));
}

function descriptionOf(text: string): string {
  return /^description: (.*)$/m.exec(text)?.[1] ?? "";
}

describe("skill が読み切れる長さに収まっている", () => {
  it("本文が上限の行数以内", () => {
    const found = skills();
    expect(found.length, "走査が空振りしている").toBeGreaterThanOrEqual(MIN_SKILLS);

    const tooLong = found
      .filter(({ text }) => text.split("\n").length > MAX_LINES)
      .map(({ name }) => name);

    expect(tooLong, "長すぎる。/skill-care で圧縮すること").toEqual([]);
  });

  it("説明文があり、上限の文字数以内", () => {
    const offenders = skills()
      .filter(({ text }) => {
        const length = descriptionOf(text).length;
        return length === 0 || length > MAX_DESCRIPTION_CHARS;
      })
      .map(({ name }) => name);

    expect(offenders, "説明文が無いか長すぎる。いつ使うかだけを書くこと").toEqual([]);
  });

  it("説明文の読み取りそのもの", () => {
    expect(descriptionOf("---\nname: a\ndescription: いつ使うか\n---\n")).toBe("いつ使うか");
    expect(descriptionOf("---\nname: a\n---\n")).toBe("");
  });
});
