import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * リポジトリ横断の検査が歩くファイル。**「何を走査するか」をここ1箇所で決める。**
 *
 * 各検査が自前で歩くと、`__tests__` を含めるかどうかが検査ごとに違ったまま
 * 理由がどこにも書かれない状態になる。除外を1つ足したいとき、直す場所が
 * 散っていて、1つ直し忘れても違反が減るだけなので緑のまま通る。
 *
 * **`__tests__` は既定で含める。** テストのコードも読み手が読むコードで、
 * コメントの規約も import の規則も同じに掛かる。期待値として規約違反の形を
 * 書く必要がある検査（自分自身を走査するもの）だけが外す。
 */

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
