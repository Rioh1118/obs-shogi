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
 * 型は `createContext<…>` の引数から引く。見るのは本体の `{ … }` の欄だけで、
 * `State & { … }` の左辺は見ない。
 *
 * 綴りの語の一致で数えるので、同じ綴りの別物が在ると読み手が在ると読む。
 * 落とすのは「確かに0件」のものだけ。
 */
const ENTITIES = join(SRC, "entities");

/**
 * 読み手が来る日が決まっている欄。理由を書いて足す。
 * `game-session` の2欄は、対局の面を戻すときに読む（ADR-0011 決定1）。
 */
const AWAITING_READER = [
  "entities/game-session/model/context.ts: startRefusal",
  "entities/game-session/model/context.ts: closeSession",
];

/** `createContext<X | null>` の `X` を返す。プリミティブは欄を持たないので拾わない */
function contextTypeNames(source: string): string[] {
  return [...source.matchAll(/createContext<([A-Z]\w*)/g)].map((match) => match[1]);
}

/** `export type <name> = … {` の本体の、2字下げの欄の名前を返す。宣言が無ければ `null` */
function membersOf(source: string, name: string): string[] | null {
  const body = new RegExp(`export type ${name} = [^{]*\\{\\n([\\s\\S]*?)\\n\\};`).exec(source)?.[1];
  if (body === undefined) return null;
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
}

type Source = { path: string; text: string };

function productionSources(): Source[] {
  return tsFiles(SRC)
    .filter((path) => !/(__tests__|\.test\.tsx?$)/.test(path))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** 欄を宣言した `model` の外の本番のコードに、語として現れない欄を返す */
function scan() {
  const files = productionSources();
  const dead: string[] = [];
  const unresolved: string[] = [];
  let contexts = 0;

  for (const slice of readdirSync(ENTITIES)) {
    const model = join(ENTITIES, slice, "model");
    const inside = files.filter((file) => file.path.startsWith(`${model}/`));
    const outside = files.filter((file) => !file.path.startsWith(`${model}/`));

    for (const name of inside.flatMap((file) => contextTypeNames(file.text))) {
      contexts += 1;
      const declared = inside.flatMap((file) => {
        const members = membersOf(file.text, name);
        return members ? [{ file, members }] : [];
      });
      if (declared.length === 0) unresolved.push(name);

      for (const { file, members } of declared) {
        for (const member of members) {
          const word = new RegExp(`\\b${member}\\b`);
          if (!outside.some((other) => word.test(other.text))) {
            dead.push(`${relative(SRC, file.path)}: ${member}`);
          }
        }
      }
    }
  }
  return { dead, unresolved, contexts };
}

describe("Context の欄の読み手", () => {
  test("型の名前と欄を拾う", () => {
    expect(
      contextTypeNames("createContext<AType | null>(null); createContext<string>('')"),
    ).toEqual(["AType"]);
    expect(
      membersOf(
        "export type A = State & {\n  a: () => void;\n  /** doc */\n  b?: string;\n};",
        "A",
      ),
    ).toEqual(["a", "b"]);
    expect(membersOf("export type B = {\n  a: string;\n};", "A")).toBeNull();
  });

  /** 型の名前を引けなくなると、その Context は黙って素通りする */
  test("全部の Context の型を引けている", () => {
    const { unresolved, contexts } = scan();

    expect(unresolved).toEqual([]);
    expect(contexts).toBeGreaterThanOrEqual(11);
  });

  test("読み手の無い欄が無い", () => {
    expect(scan().dead.sort()).toEqual([...AWAITING_READER].sort());
  });
});
