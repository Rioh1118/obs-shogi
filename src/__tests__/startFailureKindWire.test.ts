import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustFile, SRC } from "./walk";

/**
 * Rust の `StartFailureKind` が、TS の写しの union に全部届いていることを見る。
 *
 * 写し先の `ENGINE_START_FAILURE_NOTICES` と `START_FAILURE_KINDS` は `Record` なので
 * 綴りを足さなければ tsc が落ちるが、**落ちるのは TS の union を編集した後だけ**。
 * Rust にだけ種類を足した状態は、これが無いと誰も赤くしない——その種類は
 * `asStartFailure` が `unknown` に落とし、帯は汎用の文言になる。
 *
 * **ゲートの都合で TS 側に置いてある。** `gate_kinds_for_path` は `.rs` を
 * `ts` にも分類するので、ここに置けば**どちらを触ったコミットでも走る**。
 * `cargo test` 側に置くと、TS の写しだけを触ったコミットで一度も走らない
 * （`fileTreeWire` が同じ理由で TS 側に居る）。
 *
 * **宣言の綴りを camelCase にした形が線の綴りだ、という前提で引いている。**
 * その前提は serde 本体が保証する側に置いてある
 * （`engine::start_failure::tests::every_start_failure_kind_goes_on_the_wire_as_camel_case`）。
 * **`#[serde(rename)]` をここで読もうとしないこと** —— 読めたつもりで読み落とすと、
 * 線の綴りが変わったのにここは緑で通る。
 *
 * **見るのは Rust → TS の向きだけ。** 逆（TS にあって Rust に無い綴り）は
 * 表の死に項になるだけで、値としては一度も届かない。
 */

const RUST_ENUM = rustFile("engine", "types.rs");
const TS_WIRE = join(SRC, "entities", "engine", "api", "rust-types.ts");

/** `StartFailureKind` のバリアント名。**属性行と doc は落とす** */
function rustVariants(): string[] {
  const source = readFileSync(RUST_ENUM, "utf8");
  const start = source.indexOf("pub enum StartFailureKind {");
  if (start < 0) throw new Error("types.rs に StartFailureKind の宣言が無い");

  const body = source.slice(start);
  const end = body.indexOf("\n}");
  if (end < 0) throw new Error("StartFailureKind の宣言が閉じていない");

  return body
    .slice(0, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z]\w*,$/.test(line))
    .map((line) => line.slice(0, -1));
}

/** バリアント名 → 線に出る綴り（`serde(rename_all = "camelCase")` と同じ写像） */
function wireName(variant: string): string {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

/**
 * 写しの union が並べている綴り。
 *
 * **コメント行を落としてから読む。** 落とさないと、`| "foo"` を消して
 * `// いずれ "foo" を足す` と書き換えただけで「在る」ことになる。
 * 宣言の**前**の TSDoc は `=` で切る時点で落ちるが、`=` と `;` の間に
 * 書いたコメントはスライスに残る。
 */
function unionMembers(): string[] {
  const source = readFileSync(TS_WIRE, "utf8");
  const start = source.indexOf("export type StartFailureKind =");
  if (start < 0) throw new Error("写しに StartFailureKind の宣言が無い");

  const body = source.slice(start + "export type StartFailureKind =".length);
  const end = body.indexOf(";");
  if (end < 0) throw new Error("union が `;` で終わっていない");

  return body
    .slice(0, end)
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .split("|")
    .map((member) => member.trim().replace(/^"|"$/g, ""))
    .filter((member) => member.length > 0);
}

describe("StartFailureKind の受け渡し", () => {
  it("Rust の起動の失敗の種類が TS の写しに全部ある", () => {
    const variants = rustVariants();
    // 走査が空振りしても「不足0」になる。宣言を読めていることを別に固定する
    expect(variants.length, "バリアントを1つも拾えていない").toBeGreaterThan(4);

    const union = new Set(unionMembers());
    expect(union.size, "union の綴りを1つも拾えていない").toBeGreaterThan(4);

    const missing = variants.map(wireName).filter((wire) => !union.has(wire));

    expect(
      missing,
      [
        "Rust だけにある起動の失敗の種類。フロントは `unknown` に落として汎用の帯を出す。",
        "src/entities/engine/api/rust-types.ts の union に足し、tsc が指す表",
        "（`START_FAILURE_KINDS` と `ENGINE_START_FAILURE_NOTICES`）を埋めること。",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });
});
