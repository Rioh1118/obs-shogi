import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * docs が指すソースのパスが実在するかを見る検査の本体。
 * `docsSourcePaths.test.ts` が個々の振る舞いを固定し、`docs/state-transitions/` の
 * 全ファイルへ掛ける（`docs/` 全体に掛けない理由はテスト側の doc）。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。
 */

/**
 * リポジトリの起点から書いた接頭辞。この順に前へ付けて実在を探す。
 *
 * 表は接頭辞を省いて `entities/kifu/model/cursor.ts` とも書く。前だけ見て
 * `src/` 始まりに絞ると、そう書かれたパスは**拾われず黙って緑になる**。
 * 検査が「doc の指すパスは機械で守られている」と言う以上、省いた形も追う。
 */
const ROOTS = ["", "src/", "src-tauri/src/"];

/** 接頭辞を補ったうえで実在する形を返す。どれも無ければ元のまま返す */
function resolve(path: string): string {
  return ROOTS.map((root) => root + path).find((p) => existsSync(join(REPO_ROOT, p))) ?? path;
}

/**
 * バッククォートで囲まれたソースのパスを拾う。
 *
 * 拾うのはバッククォートの中だけ。地の文の「src/entities あたり」まで拾うと、
 * 説明のために書いたディレクトリ名で落ちる。
 *
 * 末尾の `#L12` や `:42` は落とす。行番号は腐っても検査したいのはファイルの実在。
 */
export function sourcePathsIn(markdown: string): string[] {
  const found = new Set<string>();

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.#:-]*)+$/.test(inline)) continue;

    const path = resolve(inline.replace(/[#:]L?\d+$/, ""));
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
