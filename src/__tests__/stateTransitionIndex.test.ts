import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  docsPath,
  headingSlug,
  headingSlugs,
  markdownFiles,
  staleUncreatedNames,
  stripFences,
  TABLES_DIR,
  tables,
} from "./stateTransitionIndex";

/**
 * `docs/state-transitions/README.md` は在庫の一覧を兼ねていて、「未作成を消さないこと」と
 * 宣言している。索引と実在するファイルがずれると、次に書く人が既存の表に気づかず
 * 重複した表を作る。ずれ方は3つあり、それぞれ別のテストで見る。
 */
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
      const abs = docsPath(file);
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
   * 本文中の3通りある。判定は `staleUncreatedNames` が持つ。
   */
  test("実在する表を「未作成」と書いている行が無い", () => {
    const stale: string[] = [];
    const exists = (name: string) => existsSync(join(TABLES_DIR, name));

    for (const file of tables()) {
      readFileSync(join(TABLES_DIR, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const name of staleUncreatedNames(line, exists)) {
            stale.push(`${file}:${i + 1}  ${name}`);
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

  test("フェンスの中の見出しはアンカーにならない", () => {
    // 例として書いた見出しを数えると、そこへのリンクが「見出しがある」と通ってしまう。
    expect(headingSlugs("```\n# 例\n```\n\n# 本物\n")).toEqual(new Set(["本物"]));
  });
});

describe("staleUncreatedNames", () => {
  // 在庫表の腐り方は「リンクを張ってから状態欄を直し忘れる」なので、リンク形も拾う。
  // 一方で、1行に未作成のものと書けたものを並べただけでは落ちてはいけない。
  const exists = (name: string) => name === "game.md";

  test.each([
    ["| [game.md](game.md) | ❌ 未作成 | L1 |", ["game.md"]],
    ["| `game.md` | ❌ 未作成 | L1 |", ["game.md"]],
    ["…は [game.md](game.md)（未作成）が持つ。", ["game.md"]],
    ["`search.md` は未作成。`game.md` は書けている", []],
    ["| `search.md` | ❌ 未作成 | まだ |", []],
  ])("%s", (line, expected) => {
    expect(staleUncreatedNames(line, exists)).toEqual(expected);
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

  test("開きより長い閉じでも閉じる", () => {
    const body = ["```", "[例](nope.md)", "`````", "", "[本物](real.md)"].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("情報文字列の付いた行は閉じない", () => {
    // 閉じに情報文字列は書けないので、これは中身の一部。閉じと見なすと、
    // 続く例が本文として漏れる。
    const body = ["```", "```js", "[例](nope.md)", "```", "", "[本物](real.md)"].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("記号の違うフェンスでは閉じない", () => {
    const body = [
      "```",
      "[例](nope.md)",
      "~~~",
      "[例2](nope2.md)",
      "```",
      "",
      "[本物](real.md)",
    ].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).not.toContain("nope2.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("閉じていないフェンスは末尾まで飲み込む", () => {
    expect(stripFences("```\n[例](nope.md)\n")).not.toContain("nope.md");
  });

  test("開きより浅い閉じでも閉じる", () => {
    // CommonMark は閉じの字下げを開きに一致させることを求めない。
    // 一致を要求すると、この形でファイルの残り全部を飲み込む。
    const body = ["   ```", "[例](nope.md)", "```", "", "[本物](real.md)"].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("箇条書きが字下げ不足で終わる形では、閉じの扱いが CommonMark と食い違う", () => {
    // CommonMark では列0の ``` は閉じではない。字下げ不足でリスト項目が終わり、
    // そこでフェンスも終わり、列0の ``` が**新しい開き**になるので real.md は
    // コードブロックの中に入る。包含ブロックの字下げを追っていないのでそうならない。
    //
    // 食い違いは誤検知の側に倒れる。実在しないリンクを見に行って落ちるだけで、
    // 検査が黙って盲になる側ではないので、この形のためだけに包含ブロックは追わない。
    const body = ["- 例:", "", "    ```", "    [例](nope.md)", "```", "", "[本物](real.md)"].join(
      "\n",
    );

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("フェンスの中の字下げされたフェンスでは閉じない", () => {
    // 箇条書きの中のフェンスの書き方を、markdown フェンスで囲んで説明する形。
    // 字下げ幅に上限を置かないと4行目が閉じになり、中身が本文として漏れたうえで
    // 本物の閉じが新しい開きになり、そのファイルの残り全部を飲み込む。
    const body = [
      "```markdown",
      "- 例:",
      "",
      "    ```",
      "    [例](nope.md)",
      "```",
      "",
      "[本物](real.md)",
    ].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });

  test("箇条書きの中の字下げフェンスも落とす", () => {
    const body = [
      "- 例:",
      "",
      "    ```",
      "    [例](nope.md)",
      "    ```",
      "",
      "[本物](real.md)",
    ].join("\n");

    expect(stripFences(body)).not.toContain("nope.md");
    expect(stripFences(body)).toContain("real.md");
  });
});
