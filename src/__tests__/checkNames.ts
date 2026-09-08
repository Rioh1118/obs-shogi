import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, RUST_CHECKS_DIR, SRC, tsFiles } from "./walk";

/**
 * 検査の名前をファイルから導く。**母数をここ1箇所に置く。**
 *
 * 引き手は2つ——`ratchetIndex` が `CONTRIBUTING.md` の表と突き合わせ、
 * `docsIdentifiers` の免除の検査が「検査の名前を免除に入れていないか」を見る。
 * **写しを作らない。** 片方だけが TS しか知らない状態になると、Rust の検査名は
 * 免除に黙って入る（現にその形で入りかけた）。
 */

/** `src/` 側の検査。ファイル名から拡張子（と `.ratchet`）を落としたものを名前とする */
export function existingChecks(): Set<string> {
  const names = tsFiles(SRC, { includeTests: true })
    .map((p) => relative(REPO_ROOT, p))
    .filter((p) => p.endsWith(".test.ts") || p.endsWith(".test.tsx"))
    .map((p) => checkName(p));

  return new Set(names);
}

/** ファイルのパスから、表の1列目と突き合わせる名前を取る */
export function checkName(path: string): string {
  return path
    .split("/")
    .pop()!
    .replace(/(\.ratchet)?\.test\.tsx?$/, "");
}

/**
 * `src-tauri/tests` にある Rust の検査の名前。
 *
 * **サブディレクトリも歩く。** 共有ヘルパの既定の置き場（`tests/scanning/`）に
 * 置いた検査が、`isFile()` で止めると丸ごと索引の死角に落ちる——
 * 「両方に載っていないと落ちる」と表と `RUST_CHECKS` の両方が書いているのに、
 * サブディレクトリでは何も落ちない状態になる。
 *
 * `mod.rs` はディレクトリの名前で採る（`scanning/mod.rs` → `scanning`）。
 */
export function rustChecks(): string[] {
  const walk = (dir: string, name: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return walk(join(dir, entry.name), entry.name);
      if (!entry.name.endsWith(".rs")) return [];
      return [entry.name === "mod.rs" ? name : entry.name.replace(/\.rs$/, "")];
    });

  return [...new Set(walk(RUST_CHECKS_DIR, "tests"))].sort();
}


/**
 * すべての検査の名前。TS と Rust の両方、および `.test.ts` を持たない検査本体
 * （`ownedSpelling` / `walk` のような走査の道具）。
 *
 * **道具まで含めるのは、免除の側の要求。** doc やコメントからその綴りを指したくなる
 * のは検査本体も同じで、免除に入れると「その名前を守る検査」が自分の名前を守れなくなる。
 */
export function allCheckNames(): Set<string> {
  // **`checkName` は使わない。** あちらは `.test.ts` しか落とさないので、
  // 走査の道具は拡張子付きのまま集合に入り、免除の照合が当たらない。
  const helpers = tsFiles(SRC, { includeTests: true })
    .map((p) => relative(REPO_ROOT, p))
    .filter((p) => p.startsWith("src/__tests__/") && !/\.test\.tsx?$/.test(p))
    .map((p) => p.split("/").pop()!.replace(/\.tsx?$/, ""));

  return new Set([...existingChecks(), ...rustChecks(), ...helpers]);
}
