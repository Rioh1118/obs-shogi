import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * docs が指すソースのパスが実在するかを見る検査の本体。
 * `docsSourcePaths.test.ts` が個々の振る舞いを固定し、同じ関数を docs 全体に掛ける。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。
 */

/**
 * バッククォートで囲まれた `src/...` / `src-tauri/...` を拾う。
 *
 * 拾うのはバッククォートの中だけ。地の文の「src/entities あたり」まで拾うと、
 * 説明のために書いたディレクトリ名で落ちる。
 *
 * 末尾の `#L12` や `:42` は落とす。行番号は腐っても検査したいのはファイルの実在。
 */
export function sourcePathsIn(markdown: string): string[] {
  const found = new Set<string>();

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (!/^(src-tauri|src)\/[A-Za-z0-9_./#:-]+$/.test(inline)) continue;

    const path = inline.replace(/[#:]L?\d+$/, "");
    // 拡張子か末尾のスラッシュがあるものだけ。`src/entities/kifu` のような
    // スライス名は「置き場」の話であってファイルを指していない
    if (!/\.[a-z]+$|\/$/.test(path)) continue;

    found.add(path);
  }

  return [...found].sort();
}

/** 実在しないものだけを返す */
export function missingPaths(paths: string[]): string[] {
  return paths.filter((p) => !existsSync(join(REPO_ROOT, p)));
}
