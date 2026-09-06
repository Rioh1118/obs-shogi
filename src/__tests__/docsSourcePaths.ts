import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * docs が現物を指せているかを見る検査の本体。**掛かる範囲が2つに分かれる。**
 *
 * - パスの実在（`sourcePathsIn` / `missingPaths`）: `docs/state-transitions/` だけ
 * - 行番号（`lineNumberRefsIn`）: `docs/` 全体
 *
 * 前者を絞るのは、他リポジトリのパスを根拠として引くファイルがあり、それを
 * 免除に挙げ切れていないため。後者を絞らないのは、自リポジトリを行番号で
 * 指せばどこに書いてあっても無言でずれるため。理由はテスト側の doc に書く。
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
 * レイヤ名でも起点でもない綴り（外部 URL など）も追わない。
 *
 * **他リポジトリのパスも、起点の綴りが重なれば追ってしまう。** 追うかどうかを
 * 決めているのは `ROOTED`（`src/` `src-tauri/` `docs/` 始まり）で、`LAYER` では
 * 弾けない —— ShogiHome の `src/background/` はレイヤ名ではないが `ROOTED` に当たる。
 * ここで他リポジトリを見分けようとすると、こちらの `src/` を追わなくなるか、
 * あちらの `src/` で赤くなるかのどちらかにしかならない。
 * 区別は書き手が付ける —— バッククォートではなく外部リンクで書く
 * （`docs/state-transitions/README.md` の規約）。
 */
function tracked(inline: string, resolved: string): boolean {
  if (/^\.\.?\//.test(inline)) return false;
  return ROOTED.test(resolved) || LAYER.test(inline);
}

/**
 * 行番号の綴り。**この1つを両方の検査が使う。**
 *
 * 綴りの知識が2つに割れると、片方だけが狭くなる。狭いほうが知らない綴りは
 * 両方の検査を素通りする——パス側は「行番号なので落とす」と判断し、
 * 行番号側は「知らない形」として見逃すため。
 *
 * 拾う形は `:42` / `:19-24` / `#L42` / `:L42` と、続けて並べた `:38, 49` /
 * `:73-77, 176-180`。**並べた側にも範囲を許すこと**——許さないと、
 * 範囲を並べた綴りがどちらの検査も通り抜ける（パス側は空白とカンマで弾かれ、
 * 行番号側は知らない形として見逃す）。
 */
const LINE_SUFFIX = /[#:]L?\d+(-L?\d+)?(,\s*L?\d+(-L?\d+)?)*$/;

/**
 * バッククォートで囲まれたソースのパスを拾う。
 *
 * 拾うのはバッククォートの中だけ。地の文の「src/entities あたり」まで拾うと、
 * 説明のために書いたディレクトリ名で落ちる。
 *
 * 末尾の行番号は落とす。行番号は腐っても、ここで検査したいのはファイルの実在。
 * 行番号そのものは `lineNumberRefsIn` が別に止める。
 */
export function sourcePathsIn(markdown: string): string[] {
  const found = new Set<string>();

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.#:-]*)+$/.test(inline)) continue;

    const bare = inline.replace(LINE_SUFFIX, "");
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
 * **行番号は誰も検査していない。** ファイルの実在は `missingPaths` が見ているが、
 * その中の何行目かは、1行足すだけで無言でずれる。読み手はそこを開いて
 * 別のものを読み、doc が指していたはずのものは自力で探すことになる。
 * ずれたことは誰にも分からないので、腐り方としては死んだパスより悪い。
 *
 * 指したいものがあるなら識別子で指すこと。`docsIdentifiers` がそちらは見る。
 *
 * **版を固定すると宣言した文書では、この木のどこにも無いファイルを見ない。**
 * 他リポジトリの識別子はこちらの検査が追えないので「識別子で指せ」の逃げ道が無く、
 * 代わりに版ごと引くのが `docs/state-transitions/README.md` の規約
 * （「…の行番号は、すべて v9.40 時点」の形）。版が書いてあれば無言ではずれない。
 *
 * **免除するかは実在で決める。綴りの形では決めない。** `tracked` は
 * 「実在を要求してよい形か」を見る別の関門で、`README.md` のような起点直下の
 * ファイルにも、拡張子の無い識別子にも当たらない。それを流用すると、
 * `optional_number:42` や `README.md#L10` まで宣言1行で通ってしまう。
 *
 * **裸の識別子は上流でも免除しない。** スラッシュも拡張子も持たない綴りは
 * `docsIdentifiers` が追える側で、「識別子で指せ」の逃げ道が実在する。
 *
 * 綴りは `LINE_SUFFIX` の1つだけを使う。**このファイル自身は走査の対象外**
 * （`src/__tests__` は `docs/` の外）なので、上に例を書いてよい。
 */
export function lineNumberRefsIn(markdown: string): string[] {
  const found = new Set<string>();
  const pinned = /`v?\d+(\.\d+)+`[^\n]*時点/.test(markdown);

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    // ファイル名を省いた `:29` `:29-35` も拾う。**省いた形のほうが悪い**——ずれたときに
    // どのファイルの29行目かも辿れない。
    // `#2c3639`（色）を巻き込まないよう `#` は受けず、`03:00` は数字始まりなので当たらない
    const bare = /^:\d+(-\d+)?$/.test(inline);

    // 前が識別子かパスであること。`03:00` のような綴りを巻き込まない
    // 版を固定した文書の行だけの綴りは、一次資料（この repo に無いソース）の行。
    // 版を書いてあれば、あちらが動いたときにどの版の行かは辿れる
    if (bare && pinned) continue;

    // 行だけの綴り（`:29`）は前の識別子を持たないので、その検査を飛ばす
    if (!bare && !/^[A-Za-z_][A-Za-z0-9_./-]*[#:]/.test(inline)) continue;
    if (!bare && !LINE_SUFFIX.test(inline)) continue;

    // 版を固定した文書では、この repo に無いパス（一次資料の行番号）を拾わない
    const withoutLine = inline.replace(LINE_SUFFIX, "");
    const looksLikePath = withoutLine.includes("/") || /\.[A-Za-z0-9]+$/.test(withoutLine);
    const resolvable = ROOTS.some((root) => existsSync(join(REPO_ROOT, root + withoutLine)));
    if (!bare && pinned && looksLikePath && !resolvable && !LAYER.test(withoutLine)) continue;

    found.add(inline);
  }

  return [...found].sort();
}
