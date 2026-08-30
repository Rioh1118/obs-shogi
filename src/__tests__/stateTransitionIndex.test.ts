import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 状態遷移表の在庫と索引を突き合わせる
 *
 * `docs/state-transitions/README.md` は「未作成を消さないこと」と書いて在庫の一覧として
 * 使うことを宣言している。表を足したのに索引に書き忘れると、次に書く人が
 * 既存の表に気づかず重複した表を作る。実際に1件そうなった。
 */
const DIR = join(process.cwd(), "docs/state-transitions");

const tables = () =>
  readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

/** GitHub の見出しアンカー。日本語は落とさず、記号と空白だけを潰す */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

const headingSlugs = (body: string) =>
  new Set([...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1] ?? "")));

describe("状態遷移表の索引", () => {
  test("README がすべての表を列挙している", () => {
    const files = tables().filter((f) => f !== "README.md");
    const readme = readFileSync(join(DIR, "README.md"), "utf8");

    const missing = files.filter((f) => !readme.includes(`(${f})`));
    expect(missing).toEqual([]);
  });

  /**
   * 表どうしのリンクは腐っても誰も気づかない。実際に `[game](#未作成の表)` という
   * 存在しない見出しへのリンクが、L0 から L1 への唯一の導線として残っていた。
   */
  test("表の中の相対リンクが実在するファイルと見出しを指す", () => {
    const broken: string[] = [];

    for (const file of tables()) {
      const body = readFileSync(join(DIR, file), "utf8");

      for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1] ?? "";
        if (/^(https?:|mailto:)/.test(href)) continue;

        const [path, anchor] = href.split("#");
        const target = path === "" ? file : path;
        const abs = join(DIR, target);

        if (!existsSync(abs)) {
          broken.push(`${file}  ${href}  （ファイルが無い）`);
          continue;
        }
        if (anchor && !headingSlugs(readFileSync(abs, "utf8")).has(anchor.toLowerCase())) {
          broken.push(`${file}  ${href}  （見出しが無い）`);
        }
      }
    }

    expect(broken, ["状態遷移表のリンクが切れている:", ...broken].join("\n")).toEqual([]);
  });

  /**
   * 表を書いたあと、他の表に残った「（未作成）」を消し忘れる。README の在庫表しか
   * 見ていないと、file-tree から入った人は出来ている表に辿り着けない。
   */
  test("実在する表を「未作成」と書いている箇所が無い", () => {
    const stale: string[] = [];

    for (const file of tables()) {
      const body = readFileSync(join(DIR, file), "utf8");

      for (const m of body.matchAll(/`([\w-]+\.md)`（未作成）/g)) {
        if (existsSync(join(DIR, m[1] ?? ""))) stale.push(`${file}  ${m[0]}`);
      }
    }

    expect(stale, ["実在する表を未作成と書いている:", ...stale].join("\n")).toEqual([]);
  });
});
