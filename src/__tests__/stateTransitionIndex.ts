import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `docs/state-transitions/` の索引が腐っていないかを見る検査の本体。
 * `stateTransitionIndex.test.ts` が個々の振る舞いを固定し、同じ関数を docs 全体に掛ける。
 *
 * 本体をここへ出すのは、テストファイルの中に判定を書くと**テストが本体でなくコピーを叩く**
 * 形になり得るため。実際にそうなっていて、検査に1本もテストが掛かっていない状態が
 * しばらく続いた（変異を当てても全件緑のままだった）。
 */

const DOCS = join(process.cwd(), "docs");

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

/**
 * コードフェンスの中身を落とす。中は説明のための例なので、リンクとしても見出しとしても
 * 数えない。
 *
 * 閉じ記号は開きと同じ記号・同じ長さ以上のものだけ、という規則を行単位で見る。
 * 正規表現1本で済ませると、4連バッククォートで3連を囲んだ入れ子で外側の開きが内側の
 * 開きと対になり、**例として書いたリンクが本文として残る**。未閉じも同じ側に倒れる。
 */
export function stripFences(body: string): string {
  let fence: string | null = null;
  const out: string[] = [];

  for (const line of body.split("\n")) {
    // 箇条書きの中のフェンスは字下げされるので、字下げ幅は見ない。CommonMark は
    // 閉じの字下げを開きに一致させることを求めないので、一致を要求すると有効な閉じを
    // 取りこぼし、そのファイルの残り全部を飲み込む。
    const m = /^ *(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence == null) {
      if (m) {
        fence = m[1]!;
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }

    const closes =
      m != null && m[1]![0] === fence[0] && m[1]!.length >= fence.length && !m[2]!.trim();
    if (closes) fence = null;
    out.push("");
  }
  return out.join("\n");
}
