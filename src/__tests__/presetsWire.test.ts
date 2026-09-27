import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC } from "./walk";
import { camelField, camelWire, rustEnumVariants, rustStructFields } from "./rustEnum";

/**
 * プリセットのファイルの読み書きで Rust が返す種類（`PresetsLoadNotice` / `SaveFailureKind`）と、
 * 読み込みの結果（`LoadedPresets`）の欄が、
 * TS の写しに全部届いていることを見る。
 *
 * 写し先の表は全種類を書かせる形なので、TS の union に足せば tsc が落ちる。
 * **Rust にだけ足した種類は、これが無いと誰も赤くしない**——読み込みの種類は汎用の帯に落ち、
 * 保存の種類は `unknown` の帯になって、種類ごとの案内が出ない。欄の綴りが割れると、
 * TS は `undefined` を受け取る（`writable` なら常に読み取り専用になる）。
 *
 * **宣言の綴りを camelCase にした形が線の綴り**、という前提は Rust 側が固定する
 * （`presets::tests::every_kind_goes_on_the_wire_as_camel_case`）。
 * 置き場を TS 側にする理由は `gameOverReasonWire.test.ts` と同じ（`.rs` を触っても走る）。
 */

const RUST = join(REPO_ROOT, "src-tauri", "crates", "settings", "src", "presets.rs");
const TS_TYPES = join(SRC, "entities", "engine-presets", "api", "rust-types.ts");

const rustVariants = (name: string) => rustEnumVariants(RUST, name);
const wireName = camelWire;

/** TS の宣言 `export type <name> = ...;` の中の綴り。コメント行を落としてから読む */
function tsDeclaration(name: string): string {
  const source = readFileSync(TS_TYPES, "utf8");
  const head = `export type ${name} =`;
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`写しに ${name} の宣言が無い`);
  const body = source.slice(start + head.length);
  const end = body.indexOf(";\n");
  return body
    .slice(0, end)
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("プリセットのファイルの種類の受け渡し", () => {
  it("読み込みで起きたこと（PresetsLoadNotice）が TS の写しに全部ある", () => {
    const variants = rustVariants("PresetsLoadNotice");
    expect(variants.length, "バリアントを拾えていない").toBeGreaterThan(4);

    const kinds = new Set(
      [...tsDeclaration("PresetsLoadNotice").matchAll(/kind: "(\w+)"/g)].map((m) => m[1]),
    );
    expect(kinds.size, "写しの kind を拾えていない").toBeGreaterThan(4);

    const missing = variants.map(wireName).filter((wire) => !kinds.has(wire));
    expect(
      missing,
      "Rust だけにある種類。api/rust-types.ts の PresetsLoadNotice と presetsFileNotice.ts の表に足すこと",
    ).toEqual([]);
  });

  it("保存を断った理由（SaveFailureKind）が TS の写しに全部ある", () => {
    const variants = rustVariants("SaveFailureKind");
    expect(variants.length, "バリアントを拾えていない").toBeGreaterThan(2);

    const members = new Set(
      [...tsDeclaration("SaveFailureKind").matchAll(/"(\w+)"/g)].map((m) => m[1]),
    );
    const missing = variants.map(wireName).filter((wire) => !members.has(wire));
    expect(
      missing,
      "Rust だけにある種類。api/rust-types.ts の SaveFailureKind と PRESETS_SAVE_NOTICES に足すこと",
    ).toEqual([]);
  });

  it("読み込みの結果（LoadedPresets）の欄が TS の写しと同じ綴り", () => {
    const fields = rustStructFields(RUST, "LoadedPresets").map(camelField);
    expect(fields.length, "欄を拾えていない").toBeGreaterThan(3);

    const source = readFileSync(TS_TYPES, "utf8");
    const start = source.indexOf("export type LoadedPresets = {");
    expect(start, "写しに LoadedPresets の宣言が無い").toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf("\n};", start));
    const declared = new Set([...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]));
    expect([...declared].sort()).toEqual([...fields].sort());
  });
});
