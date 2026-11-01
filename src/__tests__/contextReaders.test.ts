import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { SRC, tsFiles } from "./walk";

/**
 * Context の型が公開する欄に、本番の読み手が在るか。
 *
 * `knip` は型の欄を数えず、テストの mock が読んでいれば人の目にも生きて見える。
 * 読み手の無い欄が残ると、provider の reducer と分岐がその欄のために残り続ける。
 *
 * 綴りの語の一致で数えるので、同じ綴りの別物が在ると読み手が在ると読む。
 * 落とすのは「確かに0件」のものだけ。
 */
const ENTITIES = join(SRC, "entities");

/** `export type XContextType = … {` の本体の、2字下げの欄の名前を返す */
function contextMembers(source: string): string[] {
  const body = /export type \w+ContextType = [^{]*\{\n([\s\S]*?)\n\};/.exec(source)?.[1];
  if (!body) return [];
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
}

/** 欄を宣言した `model` の外の本番のコードに、語として現れない欄を返す */
function unread(): string[] {
  const files = tsFiles(SRC)
    .filter((path) => !/(__tests__|\.test\.tsx?$)/.test(path))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const dead: string[] = [];

  for (const slice of readdirSync(ENTITIES)) {
    const model = join(ENTITIES, slice, "model");
    const outside = files.filter((file) => !file.path.startsWith(`${model}/`));

    for (const { path, text } of files) {
      if (!path.startsWith(`${model}/`)) continue;
      for (const member of contextMembers(text)) {
        const word = new RegExp(`\\b${member}\\b`);
        if (!outside.some((file) => word.test(file.text))) {
          dead.push(`${relative(SRC, path)}: ${member}`);
        }
      }
    }
  }
  return dead;
}

describe("Context の欄の読み手", () => {
  test("欄の名前を拾う", () => {
    expect(
      contextMembers(
        "export type AContextType = State & {\n  a: () => void;\n  /** doc */\n  b?: string;\n};",
      ),
    ).toEqual(["a", "b"]);
    expect(contextMembers("export type Other = {\n  a: string;\n};")).toEqual([]);
  });

  test("読み手の無い欄が無い", () => {
    expect(unread()).toEqual([]);
  });
});
