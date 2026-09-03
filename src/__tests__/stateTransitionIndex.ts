import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * `docs/state-transitions/` の索引が腐っていないかを見る検査の本体。
 * `stateTransitionIndex.test.ts` が個々の振る舞いを固定し、同じ関数を docs 全体に掛ける。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。写すと、
 * テストがコピーの方を叩き、出荷される検査に1本もテストが掛からない形になる。
 */

// 起点は `walk.ts` が決める。`process.cwd()` にすると、ランナーの起動場所が
// 別の作業ツリーだったときに違う木の docs を読む
const DOCS = join(REPO_ROOT, "docs");

/** 状態遷移表の置き場。索引（`README.md`）も表もここに並ぶ */
export const TABLES_DIR = join(DOCS, "state-transitions");

/** `TABLES_DIR` 直下のファイル名（`game.md` など） */
export const tables = () =>
  readdirSync(TABLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

/** `DOCS` からの相対パス（`state-transitions/game.md` など） */
export const markdownFiles = () =>
  readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .sort();

/** `DOCS` からの相対パスを絶対パスにする */
export const docsPath = (relative: string) => join(DOCS, relative);

/**
 * github-slugger と同じ規則。小文字化し、文字・数字・結合文字・`_`・`-`・空白以外を落とし、
 * 空白1つをハイフン1つに置き換える。日本語は落とさない。
 *
 * 「空白をまとめてハイフン1つ」にすると、`—` を挟む見出し（`書き込み — 7経路…`）で
 * GitHub 上のアンカーと1文字ずれる。GitHub で飛べるリンクをこのテストが落とす形になるので、
 * 1対1で置き換える。
 */
export const headingSlug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Pc}\p{M}\- ]/gu, "")
    .replace(/ /g, "-");

/**
 * 1つの文書が持つアンカーの集合。
 *
 * github-slugger は同じ見出しが2度目に出たら `-1`、3度目に `-2` を付ける。
 * `表` や `不変条件` はこのリポジトリの表で実際に重複しているので、連番まで作らないと
 * `game.md#表-1` という**GitHub 上で正しく飛べるリンク**を「見出しが無い」と落とす。
 */
export const headingSlugs = (body: string) => {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();

  for (const m of stripFences(body).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = headingSlug(m[1] ?? "");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
};

/**
 * その行で「実在する表を未作成と書いている」名前を返す。
 *
 * 文（`。`）で区切ってから共起を見る。行ごと見ると
 * 「`search.md` は未作成。`game.md` は書けている」で落ちるが、区切れば落ちない。
 *
 * 表のセル（`|`）では区切らない。在庫表は名前と状態が別のセルにあり、
 * `| [game.md](game.md) | ❌ 未作成 |`（リンクを張ってから状態欄を直し忘れる）が
 * 実際の腐り方だから。同じ理由で、リンクになっている名前を除くのも駄目。
 */
export function staleUncreatedNames(line: string, exists: (name: string) => boolean): string[] {
  if (!line.includes("未作成")) return [];

  const out: string[] = [];
  for (const segment of line.split("。")) {
    if (!segment.includes("未作成")) continue;
    const names = new Set([...segment.matchAll(/([\w-]+\.md)/g)].map((m) => m[1] ?? ""));
    for (const name of names) if (exists(name)) out.push(name);
  }
  return out;
}

export type BrokenLink = { href: string; reason: "no-file" | "no-heading" };

/**
 * 1つの文書の中で、解決できない相対リンクを返す。表どうしのリンクは腐っても実行時に
 * 誰も踏まないので、見出しアンカーまでここで解決する。
 *
 * `exists` と `read` を受け取るのは、ファイルの有無と中身の取得を呼ぶ側に預けるため。
 * 判定はこの関数だけが持つ。
 *
 * 見るのは markdown のリンク記法だけ。`docs/decisions/` などがパスをコードスパンで
 * 書いている箇所は対象外で、そこは腐っても落ちない。
 */
export function brokenLinksInBody(
  body: string,
  selfPath: string,
  exists: (abs: string) => boolean,
  read: (abs: string) => string,
): BrokenLink[] {
  const broken: BrokenLink[] = [];

  // フェンスの中は落とす。例として書いたリンクまで解決しにいくと、
  // 「存在しないファイルを指す例」が docs に書けなくなる。
  for (const m of stripFences(body).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1] ?? "";
    if (/^(https?:|mailto:)/.test(href)) continue;

    const [path, anchor] = href.split("#");
    // 空パスは同じ文書の中のアンカー（`[…](#見出し)`）を指す
    const target = path === "" ? selfPath : join(dirname(selfPath), path);

    if (!exists(target)) {
      broken.push({ href, reason: "no-file" });
      continue;
    }
    // 画像などに見出しは無いので、アンカーが付いていても解決しない
    if (!target.endsWith(".md")) continue;
    if (anchor && !headingSlugs(read(target)).has(headingSlug(anchor))) {
      broken.push({ href, reason: "no-heading" });
    }
  }
  return broken;
}

/**
 * 1つの文書の中で「実在する表を未作成と書いている」箇所を、1始まりの行番号とともに返す。
 *
 * **ここでフェンスを落としてはいけない。** 索引の階層図はコードフェンスの中にあり、
 * 名前はバッククォートもリンクも付かない裸で書かれる。
 *
 * ```
 * L1    ├─ search.md            （未作成）インデックスと検索セッション
 * ```
 *
 * 表を書いたあと在庫表の状態欄だけ直して階層図を消し忘れる、というのが実際の腐り方の
 * 1つなので、リンク検査と同じ気持ちで `stripFences` を通すと、検査は緑のまま見逃す。
 */
export function staleUncreatedInBody(
  body: string,
  exists: (name: string) => boolean,
): { line: number; name: string }[] {
  return body
    .split("\n")
    .flatMap((line, i) => staleUncreatedNames(line, exists).map((name) => ({ line: i + 1, name })));
}

/**
 * コードフェンスの中身を落とす。中は説明のための例なので、リンクとしても見出しとしても
 * 数えない。
 *
 * 閉じ記号は開きと同じ記号・同じ長さ以上のものだけ、という規則を行単位で見る。
 * 正規表現1本で済ませると、4連バッククォートで3連を囲んだ入れ子で外側の開きが内側の
 * 開きと対になり、**例として書いたリンクが本文として残る**。未閉じも同じ側に倒れる。
 */
export function stripFences(body: string): string {
  let fence: { mark: string; indent: number } | null = null;
  const out: string[] = [];

  for (const line of body.split("\n")) {
    const m = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence == null) {
      if (m) {
        fence = { mark: m[2]!, indent: m[1]!.length };
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }

    // CommonMark の閉じは開きに字下げを合わせなくてよいが、字下げは3スペースまで。
    // この窓は両側とも狭めても広げても壊れる。狭めれば有効な閉じを取りこぼし、
    // 広げればフェンスの**中身**である字下げされたフェンスで閉じてしまう。
    // どちらもファイルの残り全部を飲み込む。
    // 包含ブロック（箇条書き）の字下げは追っていないので、開きの字下げで代用する。
    const closes =
      m != null &&
      m[2]![0] === fence.mark[0] &&
      m[2]!.length >= fence.mark.length &&
      m[1]!.length <= fence.indent + 3 &&
      !m[3]!.trim();
    if (closes) fence = null;
    out.push("");
  }
  return out.join("\n");
}
