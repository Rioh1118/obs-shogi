#!/usr/bin/env node
// 基点から作業ツリーまでの TS の変更が、型とコメントと空白だけかを確かめる。差があれば 1 で終わる。
//
// 両側を TypeScript で JS へ落として比べる。`interface` と `type` の書き換え、型の import の
// 付け替えは差にならない。宣言の並びの入れ替えと改名は差として出る。
//
//   node emit-unchanged.mjs <基点>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("基点を渡すこと。例: node emit-unchanged.mjs origin/main");
  process.exit(2);
}

const ts = createRequire(join(process.cwd(), "package.json"))("typescript");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

/** JS へ落とし、空白をつぶす。行の折り返しは差に数えない */
function emit(source, path) {
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      removeComments: true,
    },
  });
  return outputText.replace(/\s+/g, " ").trim();
}

const changed = git("diff", "--name-only", base, "--", "*.ts", "*.tsx")
  .split("\n")
  .filter((path) => path && existsSync(path));

/** 基点に無いファイルは比べる相手が無い。`git show` は落ちるので、先に見る */
function isNewFile(path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${base}:${path}`], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

let different = 0;
for (const path of changed) {
  if (isNewFile(path)) {
    console.log(`新規: ${path}`);
    different += 1;
    continue;
  }
  const before = git("show", `${base}:${path}`);
  if (emit(before, path) !== emit(readFileSync(path, "utf8"), path)) {
    console.log(`差あり: ${path}`);
    different += 1;
  }
}

console.log(`見た ${changed.length} 本、差 ${different} 本`);
process.exit(different > 0 ? 1 : 0);
