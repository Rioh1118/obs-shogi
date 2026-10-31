#!/usr/bin/env node
// 基点から作業ツリーまでの変更がコメントだけかを確かめる。差があれば 1 で終わる。
//
// 文字列の中の `//` を残すために文字列の区切りを追う。Rust の生文字列と文字リテラルは
// 追わないので、誤判定はコードの差として出る側に倒れる。差と出たら差分を読んで確かめる。
//
//   node code-unchanged.mjs <基点>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const base = process.argv[2];
if (!base) {
  console.error("基点を渡すこと。例: node code-unchanged.mjs origin/main");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

/** コメントを落とし、空白をつぶす。行の組み替えは差に数えない */
function stripComments(source) {
  let out = "";
  let at = 0;
  let quote = null;
  while (at < source.length) {
    const ch = source[at];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += source[at + 1] ?? "";
        at += 2;
        continue;
      }
      if (ch === quote) quote = null;
      at += 1;
    } else if (ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      at += 1;
    } else if (source.startsWith("//", at)) {
      const end = source.indexOf("\n", at);
      at = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", at)) {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
    } else {
      out += ch;
      at += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

const changed = git("diff", "--name-only", base, "--")
  .split("\n")
  .filter((path) => /\.(ts|tsx|rs)$/.test(path));
if (changed.length === 0) {
  console.error("対象のファイルが1本も無い。基点を確かめること");
  process.exit(2);
}

const differing = changed.filter((path) => {
  if (!existsSync(path)) return true;
  const before = git("show", `${base}:${path}`);
  return stripComments(before) !== stripComments(readFileSync(path, "utf8"));
});

console.log(`${changed.length} 本を比べた。コードの差があるのは ${differing.length} 本`);
for (const path of differing) console.log(`  ${path}`);
process.exit(differing.length === 0 ? 0 : 1);
