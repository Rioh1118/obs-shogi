import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { camelWire, rustEnumVariants } from "./rustEnum";
import { rustFile, SRC } from "./walk";

/**
 * 詰み探索の結論と、始められなかった理由の種類が、Rust と TS で同じこと。
 *
 * TS 側の表（`mateOutcomeText`、`START_FAILURE_KINDS`）は型が全種類を書かせるが、落ちるのは TS の union を
 * 編集した後だけ。Rust にだけ足した結論では、結論の1行を組む所が投げてペインごと落ちる
 */
const RUST = rustFile("engine", "types.rs");
const TS = readFileSync(join(SRC, "entities", "mate-search", "api", "rust-types.ts"), "utf8");

/** `export type <name> =` から次の `export` までの、コメントを除いた本文 */
function declaration(name: string): string {
  const body = TS.split(`export type ${name} =`)[1];
  if (!body) throw new Error(`${name} の宣言が無い`);
  return body
    .split("\nexport ")[0]!
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

const spellings = (name: string, pattern: RegExp) =>
  [...declaration(name).matchAll(pattern)].map((m) => m[1]).sort();

describe("詰み探索の種類の受け渡し", () => {
  it("結論の種類が同じ", () => {
    const rust = rustEnumVariants(RUST, "MateConclusion").map(camelWire).sort();
    expect(rust.length).toBeGreaterThan(5);
    expect(spellings("MateConclusion", /kind: "([A-Za-z]+)"/g)).toEqual(rust);
  });

  it("始められなかった理由の種類が同じ", () => {
    const rust = rustEnumVariants(RUST, "MateStartFailure").map(camelWire).sort();
    expect(rust.length).toBeGreaterThan(2);
    expect(spellings("MateStartFailureKind", /"([A-Za-z]+)"/g)).toEqual(rust);
  });
});
