import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { camelField, camelWire, rustEnumVariants, rustStructFields } from "./rustEnum";
import { rustFile, SRC } from "./walk";

/**
 * 局面検索のイベント名、enum、構造体の欄が、Rust と TS の写しで一致していることを見る。
 *
 * どちらのコンパイラもこの境界を見ない。イベント名が割れると購読に何も届かず、
 * 欄が割れると TS は `undefined` を受け取り、どちらもエラーを出さない。
 */

const RUST = rustFile("search", "types.rs");
const TS_API = join(SRC, "entities", "search", "api");

const FILES = ["contract.ts", "events.ts", "ids.ts"].map((name) =>
  readFileSync(join(TS_API, name), "utf8"),
);
const tsSource = FILES.join("\n");

/** `#[serde(rename = "gen")]` の `r#gen` は `rustStructFields` が拾わないので足す */
const RAW_IDENTIFIER_FIELDS: Record<string, string[]> = { Occurrence: ["gen"] };

const STRUCTS = [
  "OpenProjectInput",
  "OpenProjectOutput",
  "SearchPositionInput",
  "SearchPositionOutput",
  "CancelSearchInput",
  "ForkPointer",
  "Occurrence",
  "FilePathEntry",
  "CursorLite",
  "PositionHit",
  "IndexStatePayload",
  "IndexProgressPayload",
  "IndexWarnPayload",
  "SearchBeginPayload",
  "SearchChunkPayload",
  "SearchEndPayload",
  "SearchErrorPayload",
];

function tsFields(name: string): string[] {
  const start = tsSource.indexOf(`export type ${name} = {`);
  if (start < 0) throw new Error(`${name} の宣言が無い`);
  const body = tsSource.slice(start, tsSource.indexOf("\n};", start));
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

function tsUnion(name: string): string[] {
  const declaration = new RegExp(`export type ${name} = ([^;]+);`).exec(tsSource);
  if (!declaration) throw new Error(`${name} の宣言が無い`);
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("局面検索の線", () => {
  it("イベント名の綴りが揃っている", () => {
    const names = (source: string, pattern: RegExp) =>
      Object.fromEntries([...source.matchAll(pattern)].map((m) => [m[1], m[2]]));

    const rust = names(readFileSync(RUST, "utf8"), /pub const (EVT_\w+): &str = "([^"]+)"/g);
    const ts = names(tsSource, /export const (EVT_\w+) = "([^"]+)"/g);

    expect(Object.keys(rust)).toHaveLength(7);
    expect(ts).toEqual(rust);
  });

  it.each([
    ["IndexState", (variant: string) => variant],
    ["Consistency", (variant: string) => variant],
    ["IndexWarnKind", camelWire],
  ])("%s の値が揃っている", (name, wireName) => {
    expect(tsUnion(name).sort()).toEqual(rustEnumVariants(RUST, name).map(wireName).sort());
  });

  it.each(STRUCTS)("%s の欄が揃っている", (name) => {
    const rust = rustStructFields(RUST, name).map(camelField);
    const expected = [...rust, ...(RAW_IDENTIFIER_FIELDS[name] ?? [])];

    expect(tsFields(name).sort()).toEqual(expected.sort());
  });
});
