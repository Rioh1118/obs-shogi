import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * リポジトリ横断の検査が歩くファイル。**「何を走査するか」をここ1箇所で決める。**
 *
 * 各検査が自前で歩くと、`__tests__` を含めるかどうかが検査ごとに違ったまま
 * 理由がどこにも書かれない状態になる。除外を1つ足したいとき、直す場所が
 * 散っていて、1つ直し忘れても違反が減るだけなので緑のまま通る。
 *
 * **`__tests__` は既定で含める。** テストのコードも読み手が読むコードで、
 * コメントの規約も import の規則も同じに掛かる。外すのは、テストの中の記述を
 * 実装として数えると答えが変わる検査（期待値に規約違反の形を書くもの、
 * テスト中の言及を「描いている」と数えたくないもの）だけ。
 *
 * 走査の起点も**ここで決める**。`process.cwd()` から組み立てると、ランナーの
 * 起動場所が別の作業ツリーだったときにテスト本体とは違う木を読み、
 * 何を検査したのかが起動場所で変わる。
 */

/** リポジトリの根。このファイルの位置から辿る */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** アプリのソース */
export const SRC = join(REPO_ROOT, "src");

/** Rust のソース */
export const RUST_SRC = join(REPO_ROOT, "src-tauri", "src");

/**
 * Rust 側の**リポジトリ横断の検査**の置き場。
 *
 * crate をリンクせずソースを文字列として読む検査がここに入る
 * （crate の内部を見るものは `src-tauri/src` の `#[cfg(test)]`）。
 */
export const RUST_CHECKS_DIR = join(REPO_ROOT, "src-tauri", "tests");

export type WalkOptions = {
  /** `__tests__` 配下を含めるか。既定は含める */
  includeTests?: boolean;
};

function walk(dir: string, keep: (name: string) => boolean, options: WalkOptions): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" && options.includeTests === false) return [];
      return walk(path, keep, options);
    }
    return keep(entry.name) ? [path] : [];
  });
}

export function tsFiles(root: string, options: WalkOptions = {}): string[] {
  return walk(root, (name) => /\.tsx?$/.test(name), options);
}

export function scssFiles(root: string, options: WalkOptions = {}): string[] {
  return walk(root, (name) => name.endsWith(".scss"), options);
}

export function sourceFiles(root: string, options: WalkOptions = {}): string[] {
  return walk(root, (name) => /\.(tsx?|rs|scss)$/.test(name), options);
}
