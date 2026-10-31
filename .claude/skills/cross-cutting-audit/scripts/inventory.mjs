#!/usr/bin/env node
// 公開関数・型・API・エラー・文言を TSV に書き出す。
// 使い方: node inventory.mjs <出力ディレクトリ> [範囲のパス]
//
// 正規表現で拾う棚卸しなので、取りこぼしと誤検知がある。判定は棚卸しの後に本体を読んで行う。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, scope = ""] = process.argv.slice(2);
if (!outDir) {
  console.error("使い方: node inventory.mjs <出力ディレクトリ> [範囲のパス]");
  process.exit(2);
}

const isTest = (path) =>
  /__tests__|\.test\.|src-tauri\/(tests|benches)\/|\/test-support\//.test(path);

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((path) => /^(src|src-tauri)\//.test(path) && /\.(ts|tsx|rs)$/.test(path))
  .filter((path) => !isTest(path))
  .filter((path) => path.startsWith(scope));

const rows = { functions: [], types: [], api: [], errors: [], messages: [] };
const add = (kind, name, path, line, detail = "") => {
  rows[kind].push([name, path, line, detail.replaceAll("\t", " ").trim()]);
};

const JAPANESE = /[぀-ヿ一-鿿]/;
const isComment = (text) => /^\s*(\/\/|\*|\/\*)/.test(text);

function scanTs(path, line, text) {
  const fn = /^export (?:default )?(?:async )?function (\w+)/.exec(text);
  const arrow = /^export const (\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|<)/.exec(text);
  const type = /^export (?:type|interface|enum|class) (\w+)/.exec(text);
  const invoke = /invoke(?:<[^>]*>)?\(\s*["'`](\w+)["'`]/.exec(text);
  if (fn || arrow) add("functions", (fn ?? arrow)[1], path, line, text);
  if (type) add("types", type[1], path, line, text);
  if (invoke) add("api", invoke[1], path, line, "呼び出し");
  if (/throw new \w*Error/.test(text)) add("errors", "throw", path, line, text);

  for (const match of text.matchAll(/["'`]([^"'`]{2,})["'`]|>\s*([^<>{}]{2,})\s*</g)) {
    const message = match[1] ?? match[2];
    if (JAPANESE.test(message)) add("messages", message, path, line);
  }
}

function scanRust(path, line, text, previous) {
  const fn = /^\s*pub(?:\(crate\))? (?:const )?(?:async )?fn (\w+)/.exec(text);
  const anyFn = /^\s*(?:pub(?:\(crate\))? )?(?:async )?fn (\w+)/.exec(text);
  const type = /^\s*pub(?:\(crate\))? (?:struct|enum|trait|type) (\w+)/.exec(text);
  if (fn) add("functions", fn[1], path, line, text);
  if (type) add("types", type[1], path, line, text);
  if (anyFn && previous.includes("tauri::command")) add("api", anyFn[1], path, line, "コマンド");
  if (/^\s*pub(?:\(crate\))? enum \w*Error/.test(text)) add("errors", "enum", path, line, text);
  const errorText = /#\[error\("(.*)"\)\]/.exec(text);
  if (errorText) add("errors", "error", path, line, errorText[1]);

  for (const match of text.matchAll(/"([^"]{2,})"/g)) {
    if (JAPANESE.test(match[1])) add("messages", match[1], path, line);
  }
}

for (const path of files) {
  const lines = readFileSync(path, "utf8").split("\n");
  // `#[cfg(test)]` より後はテストのモジュールなので Rust では読まない。
  const testStart = lines.findIndex((text) => text.trim() === "#[cfg(test)]");
  const end = path.endsWith(".rs") && testStart >= 0 ? testStart : lines.length;
  for (let index = 0; index < end; index += 1) {
    const text = lines[index];
    if (isComment(text)) continue;
    if (path.endsWith(".rs")) {
      scanRust(path, index + 1, text, lines.slice(Math.max(0, index - 4), index).join(" "));
    } else {
      scanTs(path, index + 1, text);
    }
  }
}

const normalize = (name) => name.replaceAll("_", "").toLowerCase();

// 言語の慣習で同じ名前になるものは、同名でも意味の衝突ではない。
const CONVENTIONAL = new Set(["new", "default", "from", "fmt", "drop", "clone", "index"]);

function collisions() {
  const groups = new Map();
  for (const kind of ["functions", "types"]) {
    for (const [name, path, line] of rows[kind]) {
      const key = normalize(name);
      if (CONVENTIONAL.has(key)) continue;
      groups.set(key, [...(groups.get(key) ?? []), [kind, name, path, line]]);
    }
  }
  return [...groups.values()]
    .filter((group) => new Set(group.map(([, , path]) => path)).size > 1)
    .flatMap((group) => group.map((row) => [group.length, ...row]));
}

mkdirSync(outDir, { recursive: true });
const write = (name, table) => {
  writeFileSync(join(outDir, `${name}.tsv`), table.map((row) => row.join("\t")).join("\n") + "\n");
  console.log(`${name}: ${table.length}`);
};

for (const [kind, table] of Object.entries(rows)) write(kind, table);
write("collisions", collisions());

const empty = Object.entries(rows).filter(([, table]) => table.length === 0);
if (empty.length > 0) {
  console.error(`0件のファイルがある: ${empty.map(([kind]) => kind).join(", ")}`);
  process.exit(1);
}
