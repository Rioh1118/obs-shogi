import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, tsFiles } from "./walk";

/**
 * Rust の宣言を読む道具が `rustEnum.ts` の1か所にあること。
 *
 * 写しの検査（`*Wire.test.ts`）ごとに読み方を書くと、値つきのバリアント（`Foo { .. },`）を
 * 拾える写しと拾えない写しに割れる——値つきのバリアントを足した種類で、古い写しの検査が
 * 黙って件数を落とす（実際に3か所で割れていた）。
 */
const OWN_READERS = /function (rustVariants|wireName|rustEnumVariants|camelWire)\s*\(/;

describe("Rust の宣言を読む道具", () => {
  it("rustEnum.ts の外で定義しない", () => {
    const files = tsFiles(join(SRC, "__tests__"));
    const users = files.filter((f) => readFileSync(f, "utf8").includes('from "./rustEnum"'));
    expect(users.length, "rustEnum を使う検査を拾えていない").toBeGreaterThanOrEqual(3);

    const offenders = files
      .filter((f) => basename(f) !== "rustEnum.ts" && basename(f) !== "wireHelpers.test.ts")
      .filter((f) => OWN_READERS.test(readFileSync(f, "utf8")))
      .map((f) => basename(f));
    expect(offenders, "Rust の宣言の読み方を自前で書いている。rustEnum.ts を使うこと").toEqual([]);
  });
});
