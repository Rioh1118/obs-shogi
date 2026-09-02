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

/** リポジトリの起点から書かれた形。これで始まるものは実在を必ず要求する */
const ROOTED = /^(src|src-tauri|docs)\//;

/**
 * 接頭辞を省いても追う綴りの形。`src/` 直下のレイヤ名で始まるものだけ。
 *
 * 何にでも接頭辞を試すと、`example.com/a.html` のような**ソースでない綴り**まで
 * 「実在しないパス」として赤くなる。書いた人はソースを1つも触っていないので
 * 何を要求されたのか分からない。
 */
const LAYER = /^(app|pages|widgets|features|entities|shared)\//;

/** 接頭辞を補ったうえで実在する形を返す。どれも無ければ元のまま返す */
function resolve(path: string): string {
  return ROOTS.map((root) => root + path).find((p) => existsSync(join(REPO_ROOT, p))) ?? path;
}

/**
 * 実在を要求してよい綴りか。
 *
 * 追わないもの: 相対リンク（`./branch-index.md`）は doc どうしの参照であって
 * ソースの置き場ではない。追うと**丁寧に相対で書いた人だけが赤くなる**。
 * レイヤ名でも起点でもない綴り（外部 URL、他リポジトリのパス）も追わない。
 */
function tracked(inline: string, resolved: string): boolean {
  if (/^\.\.?\//.test(inline)) return false;
  return ROOTED.test(resolved) || LAYER.test(inline);
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

    const bare = inline.replace(/[#:]L?\d+$/, "");
    const path = resolve(bare);
    if (!tracked(bare, path)) continue;
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

/**
 * バッククォートの中に書かれた行番号を拾う。
 *
 * **行番号は誰も検査していない。** ファイルの実在は上で見ているが、
 * その中の何行目かは、1行足すだけで無言でずれる。読み手はそこを開いて
 * 別のものを読み、doc が指していたはずのものは自力で探すことになる。
 * ずれたことは誰にも分からないので、腐り方としては死んだパスより悪い。
 *
 * 指したいものがあるなら識別子で指すこと。`docsIdentifiers` がそちらは見る。
 *
 * 拾う形は `provider.tsx:19-24` / `bridge.rs:117` / `AnalysisPaneHeader:84` と、
 * 続けて並べた `provider.tsx:38, 49`。**このファイル自身は走査の対象外**
 * （`src/__tests__` は状態遷移表ではない）なので、ここに例を書いてよい。
 */
export function lineNumberRefsIn(markdown: string): string[] {
  const found = new Set<string>();

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (/^[A-Za-z_][A-Za-z0-9_./-]*:\d+(-\d+)?(,\s*\d+)*$/.test(inline)) {
      found.add(inline);
    }
  }

  return [...found].sort();
}
