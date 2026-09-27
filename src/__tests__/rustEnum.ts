import { readFileSync } from "node:fs";

/**
 * Rust の宣言を文字列として読む道具。**線の写しの検査（`*Wire.test.ts`）はここを通す**——
 * 写しごとに読み方を書くと、値つきのバリアント（`Foo { .. },`）を拾える写しと拾えない写しに割れる。
 * 1か所に保っていることは `wireHelpers.test.ts` が見る。
 */

/** `pub enum <name> {` の本体からバリアント名を取る（値つき `Foo { .. },` と値なし `Foo,` の両方） */
export function rustEnumVariants(file: string, name: string): string[] {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`pub enum ${name} {`);
  if (start < 0) throw new Error(`${file} に ${name} の宣言が無い`);
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

/** `pub struct <name> {` の欄の名前（`pub <name>:`） */
export function rustStructFields(file: string, name: string): string[] {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`pub struct ${name} {`);
  if (start < 0) throw new Error(`${file} に ${name} の宣言が無い`);
  const body = source.slice(start);
  const end = body.indexOf("\n}");
  return [...body.slice(0, end).matchAll(/^\s*pub (\w+):/gm)].map((m) => m[1]);
}

/** バリアント名 → 線に出る綴り（`serde(rename_all = "camelCase")` と同じ写像） */
export function camelWire(variant: string): string {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

/** 欄の名前（snake_case）→ 線に出る綴り（`serde(rename_all = "camelCase")` と同じ写像） */
export function camelField(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
