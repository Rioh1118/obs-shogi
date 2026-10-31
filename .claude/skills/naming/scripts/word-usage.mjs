#!/usr/bin/env node
// 識別子を語へ分解し、リポジトリの中で語がどう使われているかを数える。
//
//   node word-usage.mjs verbs [範囲...]        先頭の語（動詞）の表。関数の宣言だけを見る
//   node word-usage.mjs words [範囲...]        全ての語の表
//   node word-usage.mjs word <語> [語...]      語を含む宣言を、語の位置と場所つきで並べる
//
// 範囲を省くと `src` と `src-tauri` を見る。テストは数えない。テストの名前は文であり、
// 語の使われ方の根拠にならない。
//
// 正規表現で宣言を拾うので漏れがある。**0件は「無い」の証拠にならない。** 最後は grep で確かめる。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "target", "gen", "dist", "__tests__", "tests"]);
const FUNCTION_DECL = [
  /(?:^|\s)function\s+([A-Za-z_]\w*)/g,
  /\bconst\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(/g,
  /\bfn\s+([A-Za-z_]\w*)/g,
];
const OTHER_DECL = [
  /\b(?:class|interface|type|struct|enum|trait)\s+([A-Za-z_]\w*)/g,
  /\bconst\s+([A-Za-z_]\w*)/g,
];

function walk(path, found = []) {
  if (statSync(path).isFile()) {
    if (/\.(ts|tsx|rs)$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
    return found;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    walk(join(path, entry.name), found);
  }
  return found;
}

/** `parseKifuToJKF` → parse kifu to jkf。`read_or_default` → read or default */
function wordsOf(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** Rust のテストの `mod … {` より前の行を返す。`#[cfg(test)] mod x;` の宣言では止まらない */
function codeLines(source) {
  const lines = source.split("\n");
  const testModule = lines.findIndex(
    (line, index) => line.trim() === "#[cfg(test)]" && /^\s*(pub\s+)?mod\s+\w+\s*\{/.test(lines[index + 1] ?? ""),
  );
  return testModule < 0 ? lines : lines.slice(0, testModule);
}

function declarations(roots) {
  const decls = new Map();
  for (const root of roots) {
    for (const file of walk(root)) {
      const lines = codeLines(readFileSync(file, "utf8"));
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const [patterns, isFunction] of [
          [FUNCTION_DECL, true],
          [OTHER_DECL, false],
        ]) {
          for (const pattern of patterns) {
            for (const match of line.matchAll(pattern)) {
              const key = `${match[1]}|${file}`;
              if (!decls.has(key)) {
                decls.set(key, {
                  name: match[1],
                  file,
                  line: index + 1,
                  isFunction,
                  text: line.trim(),
                });
              }
            }
          }
        }
      });
    }
  }
  return [...decls.values()];
}

function printCounts(counts) {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [word, count] of rows) console.log(`${count}\t${word}`);
}

const [mode, ...rest] = process.argv.slice(2);
const usage = "使い方: word-usage.mjs verbs|words [範囲...] / word-usage.mjs word <語> [語...]";

if (mode === "verbs" || mode === "words") {
  const decls = declarations(rest.length > 0 ? rest : ["src", "src-tauri"]);
  if (decls.length === 0) {
    console.error("宣言を1つも拾えていない。範囲を確かめること");
    process.exit(2);
  }
  const counts = new Map();
  for (const decl of decls) {
    if (mode === "verbs" && !decl.isFunction) continue;
    const words = wordsOf(decl.name);
    for (const word of mode === "verbs" ? words.slice(0, 1) : words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  printCounts(counts);
} else if (mode === "word" && rest.length > 0) {
  const wanted = new Set(rest.map((word) => word.toLowerCase()));
  const decls = declarations(["src", "src-tauri"]);
  if (decls.length === 0) {
    console.error("宣言を1つも拾えていない。リポジトリの根で走らせること");
    process.exit(2);
  }
  for (const decl of decls) {
    const words = wordsOf(decl.name);
    const at = words.findIndex((word) => wanted.has(word));
    if (at < 0) continue;
    const place = at === 0 ? "先頭" : at === words.length - 1 ? "末尾" : "途中";
    console.log(`${place}\t${decl.name}\t${decl.file}:${decl.line}\t${decl.text.slice(0, 90)}`);
  }
} else {
  console.error(usage);
  process.exit(2);
}
