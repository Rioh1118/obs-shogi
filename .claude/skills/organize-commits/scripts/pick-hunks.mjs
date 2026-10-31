#!/usr/bin/env node
// `git diff` の出力から指定の hunk だけを取り出す。ファイルの中身を書き直さずに、同じファイルの変更を
// 別のコミットへ分けるために使う。
//
// 使い方:
//   node pick-hunks.mjs list <パッチ>                 番号と見出しを一覧する
//   node pick-hunks.mjs pick <パッチ> <path:1,3> ...  指定の hunk だけのパッチを標準出力へ出す
//
// 移動やバイナリのように hunk の無いファイルは `path:0` で選ぶ。ヘッダに差分の全部が入っている。
//
// 選んだ結果は `git apply --index --recount` に渡す。
import { readFileSync } from "node:fs";

const [command, patchPath, ...selectors] = process.argv.slice(2);
if (!["list", "pick"].includes(command) || !patchPath) {
  console.error("使い方: pick-hunks.mjs list <パッチ> | pick <パッチ> <path:1,3> ...");
  process.exit(2);
}

function parse(text) {
  const files = [];
  let file = null;
  let hunk = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: line.split(" b/").pop(), header: [line], hunks: [] };
      hunk = null;
      files.push(file);
    } else if (line.startsWith("@@") && file) {
      hunk = [line];
      file.hunks.push(hunk);
    } else if (hunk) {
      hunk.push(line);
    } else if (file) {
      file.header.push(line);
    }
  }
  return files;
}

const files = parse(readFileSync(patchPath, "utf8"));

if (command === "list") {
  for (const file of files) {
    file.hunks.forEach((hunk, index) => console.log(`${file.path}:${index + 1}\t${hunk[0]}`));
    if (file.hunks.length === 0) console.log(`${file.path}:0\t（移動かバイナリ）`);
  }
  process.exit(0);
}

const output = [];
for (const selector of selectors) {
  const separator = selector.lastIndexOf(":");
  const path = selector.slice(0, separator);
  const file = files.find((candidate) => candidate.path === path);
  if (!file) {
    console.error(`パッチに無いファイル: ${path}`);
    process.exit(1);
  }
  output.push(...file.header);
  for (const number of selector
    .slice(separator + 1)
    .split(",")
    .map(Number)) {
    if (number === 0 && file.hunks.length === 0) continue;
    const hunk = file.hunks[number - 1];
    if (!hunk) {
      console.error(`無い hunk: ${path}:${number}`);
      process.exit(1);
    }
    output.push(...hunk.filter((line, index) => index < hunk.length - 1 || line !== ""));
  }
}
process.stdout.write(`${output.join("\n")}\n`);
