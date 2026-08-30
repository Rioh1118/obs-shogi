import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `docs/state-transitions/README.md` は在庫の一覧を兼ねていて、「未作成を消さないこと」と
 * 宣言している。索引と実在するファイルがずれると、次に書く人が既存の表に気づかず
 * 重複した表を作る。ずれ方は3つあり、それぞれ別のテストで見る。
 */
const DOCS = join(process.cwd(), "docs");
const TABLES_DIR = join(DOCS, "state-transitions");

/** `TABLES_DIR` 直下のファイル名（`game.md` など） */
const tables = () =>
  readdirSync(TABLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

/** `DOCS` からの相対パス（`state-transitions/game.md` など） */
const markdownFiles = () =>
  readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .sort();

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
const headingSlugs = (body: string) => {
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
 * コードフェンスの中身を落とす。中は説明のための例なので、リンクとしても見出しとしても
 * 数えない。
 *
 * 閉じ記号は開きと同じ記号・同じ長さ以上のものだけ、という規則を行単位で見る。
 * 正規表現1本で済ませると、4連バッククォートで3連を囲んだ入れ子で外側の開きが内側の
 * 開きと対になり、**例として書いたリンクが本文として残る**。未閉じも同じ側に倒れる。
 */
function stripFences(body: string): string {
  let fence: string | null = null;
  const out: string[] = [];

  for (const line of body.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence == null) {
      if (m) {
        fence = m[1]!;
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }

    if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && !m[2]!.trim()) {
      fence = null;
    }
    out.push("");
  }
  return out.join("\n");
}

describe("状態遷移表の索引", () => {
  test("README がすべての表を列挙している", () => {
    const files = tables().filter((f) => f !== "README.md");
    const readme = readFileSync(join(TABLES_DIR, "README.md"), "utf8");

    const missing = files.filter((f) => !readme.includes(`(${f})`));
    expect(missing).toEqual([]);
  });

  /**
   * 表どうしのリンクは腐っても実行時に誰も踏まないので、見出しアンカーまでここで解決する。
   *
   * 見ているのは markdown のリンク記法だけ。`docs/decisions/` などがパスをコードスパンで
   * 書いている箇所（36箇所）は対象外で、そこは腐っても落ちない。
   */
  test("docs の中の相対リンクが実在するファイルと見出しを指す", () => {
    const broken: string[] = [];

    for (const file of markdownFiles()) {
      const abs = join(DOCS, file);
      const body = stripFences(readFileSync(abs, "utf8"));

      for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1] ?? "";
        if (/^(https?:|mailto:)/.test(href)) continue;

        const [path, anchor] = href.split("#");
        const target = path === "" ? abs : join(dirname(abs), path);

        if (!existsSync(target)) {
          broken.push(`${file}  ${href}  （ファイルが無い）`);
          continue;
        }
        if (!target.endsWith(".md")) continue;
        if (anchor && !headingSlugs(readFileSync(target, "utf8")).has(headingSlug(anchor))) {
          broken.push(`${file}  ${href}  （見出しが無い）`);
        }
      }
    }

    expect(broken, ["docs のリンクが切れている:", ...broken].join("\n")).toEqual([]);
  });

  /**
   * 表を書いたあと、他の表や索引に残った「未作成」を消し忘れる。書き方は階層図・在庫表・
   * 本文中の3通りあるので、ファイル名と「未作成」が同じ行にあることを見る。
   *
   * リンクになっている名前は除く。表が書けたら README はその名前を
   * `[search.md](search.md)` に変えるので、そこで「まだ無い名前」と「もう書けた名前」が
   * 分かれる。除かないと「`search.md` は未作成。`game.md` は書けている」の1行で落ちる。
   */
  test("実在する表を「未作成」と書いている行が無い", () => {
    const stale: string[] = [];

    for (const file of tables()) {
      const lines = readFileSync(join(TABLES_DIR, file), "utf8").split("\n");

      lines.forEach((line, i) => {
        if (!line.includes("未作成")) return;
        const linked = new Set([...line.matchAll(/\]\(([\w-]+\.md)\)/g)].map((m) => m[1]));

        for (const m of line.matchAll(/([\w-]+\.md)/g)) {
          const name = m[1] ?? "";
          if (linked.has(name)) continue;
          if (existsSync(join(TABLES_DIR, name))) stale.push(`${file}:${i + 1}  ${name}`);
        }
      });
    }

    expect(stale, ["実在する表を未作成と書いている:", ...stale].join("\n")).toEqual([]);
  });
});

describe("headingSlug", () => {
  // 見出しアンカーを使ったリンクが docs にまだ1本も無いので、上のテストからは
  // この関数が一度も呼ばれない。最初にアンカー付きリンクを書く人が踏む前に固定しておく。
  test.each([
    [
      "書き込み — 7経路のうち3経路が先の計画を捨てる",
      "書き込み--7経路のうち3経路が先の計画を捨てる",
    ],
    ["読み手 — 6箇所。捨てるのは2箇所だけ", "読み手--6箇所捨てるのは2箇所だけ"],
    ["`set_error` の置き場", "set_error-の置き場"],
    ["2つの値", "2つの値"],
  ])("%s → %s", (heading, slug) => {
    expect(headingSlug(heading)).toBe(slug);
  });

  test("同じ見出しが2度目に出たら連番が付く", () => {
    expect(headingSlugs("# 表\n\n## 表\n\n### 表\n")).toEqual(new Set(["表", "表-1", "表-2"]));
  });
});

describe("stripFences", () => {
  test("入れ子のフェンスを外側で閉じる", () => {
    const body = [
      "````markdown",
      "```",
      "[例](nope.md)",
      "```",
      "````",
      "",
      "[本物](real.md)",
    ].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("閉じていないフェンスは末尾まで飲み込む", () => {
    expect(stripFences("```\n[例](nope.md)\n")).not.toContain("nope.md");
  });
});
