import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `docs/state-transitions/README.md` は在庫の一覧を兼ねていて、「未作成を消さないこと」と
 * 宣言している。索引と実在するファイルがずれると、次に書く人が既存の表に気づかず
 * 重複した表を作る。ずれ方は3つあり、それぞれ別のテストで見る。
 */
const DOCS = join(process.cwd(), "docs");
const DIR = join(DOCS, "state-transitions");

const tables = () =>
  readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

const markdownFiles = () =>
  readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .sort();

/** コードフェンスの中は説明のための例なので、リンクとしても見出しとしても数えない */
const withoutFences = (body: string) => body.replace(/^```[\s\S]*?^```/gm, "");

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

const headingSlugs = (body: string) =>
  new Set(
    [...withoutFences(body).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => headingSlug(m[1] ?? "")),
  );

describe("状態遷移表の索引", () => {
  test("README がすべての表を列挙している", () => {
    const files = tables().filter((f) => f !== "README.md");
    const readme = readFileSync(join(DIR, "README.md"), "utf8");

    const missing = files.filter((f) => !readme.includes(`(${f})`));
    expect(missing).toEqual([]);
  });

  /** 表どうしのリンクは腐っても実行時に誰も踏まないので、見出しアンカーまでここで解決する */
  test("docs の中の相対リンクが実在するファイルと見出しを指す", () => {
    const broken: string[] = [];

    for (const file of markdownFiles()) {
      const abs = join(DOCS, file);
      const body = withoutFences(readFileSync(abs, "utf8"));

      for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1] ?? "";
        if (/^(https?:|mailto:|#!)/.test(href)) continue;

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
   * 本文中の3通りあるので、ファイル名と「未作成」が同じ行にあることだけを見る。
   */
  test("実在する表を「未作成」と書いている行が無い", () => {
    const stale: string[] = [];

    for (const file of tables()) {
      const lines = readFileSync(join(DIR, file), "utf8").split("\n");

      lines.forEach((line, i) => {
        if (!line.includes("未作成")) return;
        for (const m of line.matchAll(/([\w-]+\.md)/g)) {
          if (existsSync(join(DIR, m[1] ?? ""))) stale.push(`${file}:${i + 1}  ${line.trim()}`);
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
});
