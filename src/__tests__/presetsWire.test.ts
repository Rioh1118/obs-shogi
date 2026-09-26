import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC } from "./walk";

/**
 * プリセットのファイルの読み書きで Rust が返す種類（`PresetsNotice` / `SaveFailureKind`）が、
 * TS の写しに全部届いていることを見る。
 *
 * 写し先の表（`PRESETS_LOAD_NOTICES` / `PRESETS_SAVE_NOTICES`）は `Record` なので、TS の union に
 * 足せば tsc が落ちる。**Rust にだけ足した種類は、これが無いと誰も赤くしない**——画面は
 * 知らない種類を受け取って `undefined` を引き、通知を1枚も出さない。
 *
 * **宣言の綴りを camelCase にした形が線の綴り**、という前提は Rust 側が固定する
 * （`presets::tests::every_kind_goes_on_the_wire_as_camel_case`）。
 * 置き場を TS 側にする理由は `gameOverReasonWire.test.ts` と同じ（`.rs` を触っても走る）。
 */

const RUST = join(REPO_ROOT, "src-tauri", "crates", "settings", "src", "presets.rs");
const TS_TYPES = join(SRC, "entities", "engine-presets", "model", "types.ts");

/** `pub enum <name> {` の本体からバリアント名を取る（値つき `Foo { .. },` と値なし `Foo,` の両方） */
function rustVariants(name: string): string[] {
  const source = readFileSync(RUST, "utf8");
  const start = source.indexOf(`pub enum ${name} {`);
  if (start < 0) throw new Error(`presets.rs に ${name} の宣言が無い`);
  const body = source.slice(start);
  const end = body.indexOf("\n}");
  if (end < 0) throw new Error(`${name} の宣言が閉じていない`);
  return body
    .slice(0, end)
    .split("\n")
    .map((line) => line.trim())
    .map((line) => /^([A-Z]\w*)(?: \{|,)/.exec(line)?.[1])
    .filter((variant): variant is string => variant !== undefined);
}

function wireName(variant: string): string {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

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
  it("読み込みで起きたこと（PresetsNotice）が TS の写しに全部ある", () => {
    const variants = rustVariants("PresetsNotice");
    expect(variants.length, "バリアントを拾えていない").toBeGreaterThan(4);

    const kinds = new Set(
      [...tsDeclaration("PresetsNotice").matchAll(/kind: "(\w+)"/g)].map((m) => m[1]),
    );
    expect(kinds.size, "写しの kind を拾えていない").toBeGreaterThan(4);

    const missing = variants.map(wireName).filter((wire) => !kinds.has(wire));
    expect(
      missing,
      "Rust だけにある種類。model/types.ts の PresetsNotice と PRESETS_LOAD_NOTICES に足すこと",
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
      "Rust だけにある種類。model/types.ts の SaveFailureKind と PRESETS_SAVE_NOTICES に足すこと",
    ).toEqual([]);
  });
});
