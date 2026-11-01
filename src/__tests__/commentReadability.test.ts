import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { commentBlocks, type CommentBlock } from "./commentBlocks";
import { REPO_ROOT, rustRoots, SRC, sourceFiles } from "./walk";

/**
 * コメントを第三者が読めること（`CONTRIBUTING.md` の「コメントの書き方」）のうち、
 * 字面で判定できる6つを見る。意味の判定は `/readable-code` の手順が本文を読んで行う。
 *
 * 1. `TODO` と `FIXME` は `TODO(#123)` の形で issue 番号を持つ
 * 2. 説明は要約で始める。強調で始まる塊は要約を持たない
 * 3. 強調は1つの塊に1か所まで。全部を強調すると何も強調されない
 * 4. issue 番号で理由を指さない。読み手は番号から本文を辿れるとは限らない
 * 5. `CONTEXT.md` の「使わない語」を書かない
 * 6. 比喩の語を書かない（`METAPHOR`）
 *
 * 1 と 6 は違反0なので `-D` で張る。2〜5 は入れた時点で既存があるので件数ラチェット。
 * **基準を動かしてよい向きは下げる方だけ。** 片付けたら `BASELINE` を下げる。
 *
 * 環境変数 `COMMENT_REPORT` にパスを渡すと、該当の全行を JSON で書き出す。
 * 緑のときは一覧が出ないので、`/tidy-code` の棚卸しはこの出力から範囲の行を拾う。
 */

const BASELINE = {
  docStartsWithEmphasis: 394,
  manyEmphases: 1196,
  issueReference: 127,
  retiredTerm: 0,
};

/**
 * 走査が壊れて0件になったことを「違反が無い」と読ませないための下限。
 * 実測より大きく下に置く。最も大きい1ディレクトリを消しても越えないこと
 */
const MIN_FILES = 300;
const MIN_BLOCKS = 4000;
const MIN_DOC_BLOCKS = 2000;

const ROOTS = [SRC, ...rustRoots(), join(REPO_ROOT, "src-tauri", "tests")];

/** 語そのものをバッククォートで指す説明と、形を示す `#N` は違反ではない */
const UNNUMBERED_TODO = /(?<!`)\b(?:TODO|FIXME)\b(?!\(#(?:\d+|N)\))/;
const NUMBERED_TODO = /\bTODO\(#\d+\)/g;
const ISSUE_NUMBER = /(?<![\w/#&])#\d{2,4}\b/;
const EMPHASIS = /\*\*[^*]+?\*\*/g;

/**
 * 関数、経路、判定の代わりに使われていた比喩の1文字の語。指すものが塊ごとに違うので読めない。
 * 同じ字を含む一般の語を巻き込まないよう、前の1字で除く
 */
const METAPHOR = /(?<![入窓出人閉手利糸河火]|切り)口|(?<![専部名入])門/;

/** 表の見出しの綴り。この列が無い表は語の表ではない */
const RETIRED_COLUMN = "使わない語";

/** 塊が持つ強調の数 */
function emphasisCount(text: string): number {
  return text.match(EMPHASIS)?.length ?? 0;
}

/** `TODO(#N)` は番号の正しい使い方なので、番号の走査の前に落とす */
function hasIssueReference(text: string): boolean {
  return ISSUE_NUMBER.test(text.replace(NUMBERED_TODO, ""));
}

/**
 * Markdown の表から「使わない語」の列を読む。
 *
 * `（画面で）` が付いた語は画面の中だけで止める語で、コメントでは使ってよい。
 * 画面の語は `screenVocabulary` が別の表で見ている。
 */
function retiredTermsIn(markdown: string): string[] {
  const terms = new Set<string>();
  let column = -1;

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      column = -1;
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.includes(RETIRED_COLUMN)) {
      column = cells.indexOf(RETIRED_COLUMN);
      continue;
    }
    const cell = column >= 0 ? cells[column] : undefined;
    if (!cell || cell === "—" || /^-+$/.test(cell) || cell.includes("（画面で）")) continue;
    terms.add(cell);
  }
  return [...terms].sort();
}

/** `path:行  本文の先頭` の形にする。赤の一覧からそのまま飛べるように */
function report(name: string, block: CommentBlock): string {
  return `${name}:${block.line}  ${block.text.replace(/\n/g, " ").slice(0, 60)}`;
}

function scan(terms: string[]) {
  const found = {
    unnumberedTodo: [] as string[],
    docStartsWithEmphasis: [] as string[],
    manyEmphases: [] as string[],
    issueReference: [] as string[],
    retiredTerm: [] as string[],
    metaphor: [] as string[],
  };
  let files = 0;
  let blocks = 0;
  let docBlocks = 0;

  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      if (!/\.(ts|tsx|rs)$/.test(file)) continue;
      files += 1;
      const name = relative(REPO_ROOT, file);

      for (const block of commentBlocks(readFileSync(file, "utf8"))) {
        blocks += 1;
        if (block.doc) docBlocks += 1;

        if (UNNUMBERED_TODO.test(block.text)) found.unnumberedTodo.push(report(name, block));
        if (block.doc && block.text.startsWith("**")) {
          found.docStartsWithEmphasis.push(report(name, block));
        }
        if (emphasisCount(block.text) >= 2) found.manyEmphases.push(report(name, block));
        if (hasIssueReference(block.text)) found.issueReference.push(report(name, block));
        if (terms.some((term) => block.text.includes(term))) {
          found.retiredTerm.push(report(name, block));
        }
        if (METAPHOR.test(block.text)) found.metaphor.push(report(name, block));
      }
    }
  }
  return { found, files, blocks, docBlocks };
}

describe("走査の部品", () => {
  it("行コメントの塊を、印ごとに分けて読む", () => {
    const source = ["/// 要約", "/// 続き", "// 実装の説明", "let a = 1; // 行末"].join("\n");
    expect(commentBlocks(source)).toEqual([
      { line: 1, doc: true, text: "要約\n続き" },
      { line: 3, doc: false, text: "実装の説明" },
    ]);
  });

  it("ブロックコメントの印を落として読む", () => {
    const source = ["const a = 1;", "/**", " * 要約", " *", " * 詳細", " */", "/* 実装 */"];
    expect(commentBlocks(source.join("\n"))).toEqual([
      { line: 2, doc: true, text: "要約\n\n詳細" },
      { line: 7, doc: false, text: "実装" },
    ]);
  });

  it("文字列の中の二重斜線をコメントと読まない", () => {
    expect(commentBlocks('const url = "https://example.com";')).toEqual([]);
  });

  it("番号の無い TODO だけを拾う", () => {
    expect(UNNUMBERED_TODO.test("TODO(#123): 直す")).toBe(false);
    expect(UNNUMBERED_TODO.test("TODO: 直す")).toBe(true);
    expect(UNNUMBERED_TODO.test("FIXME 直す")).toBe(true);
    expect(UNNUMBERED_TODO.test("`TODO` の形")).toBe(false);
    expect(UNNUMBERED_TODO.test("`TODO(#N)` の形")).toBe(false);
  });

  it("TODO の番号を issue の参照に数えない", () => {
    expect(hasIssueReference("TODO(#123): 直す")).toBe(false);
    expect(hasIssueReference("TODO(#123): #456 を見る")).toBe(true);
    expect(hasIssueReference("→ #172")).toBe(true);
    expect(hasIssueReference("`#[derive(Debug)]`")).toBe(false);
  });

  it("強調を数える。改行を挟んでも1か所と読む", () => {
    expect(emphasisCount("平文")).toBe(0);
    expect(emphasisCount("**甲**と**乙**")).toBe(2);
    expect(emphasisCount("**甲\n乙**")).toBe(1);
  });

  it("比喩の語だけを拾い、同じ字を含む一般の語を巻き込まない", () => {
    for (const text of ["席を取る口", "開き口", "関門", "門番", "着手の門"]) {
      expect(METAPHOR.test(text), text).toBe(true);
    }
    for (const text of ["コマンドの入口", "窓口", "出口", "切り口", "専門", "部門"]) {
      expect(METAPHOR.test(text), text).toBe(false);
    }
  });

  it("使わない語を表の列から読み、画面だけの語を外す", () => {
    const table = [
      "| UI の表記 | 使わない語 |",
      "| --- | --- |",
      "| 定跡 | ブック |",
      "| 検討 | 解析（画面で） |",
      "| 棋譜 | — |",
      "",
      "| 語 | 注意 |",
      "| --- | --- |",
      "| 閉じる | 列が無い表 |",
    ].join("\n");
    expect(retiredTermsIn(table)).toEqual(["ブック"]);
  });
});

describe("コメントを第三者が読める", () => {
  const terms = retiredTermsIn(readFileSync(join(REPO_ROOT, "CONTEXT.md"), "utf8"));
  const { found, files, blocks, docBlocks } = scan(terms);

  it("求められたら該当の全行を書き出す", () => {
    const destination = process.env.COMMENT_REPORT;
    if (destination) writeFileSync(destination, JSON.stringify(found, null, 2));
    expect(Object.keys(found)).toContain("manyEmphases");
  });

  it("走査が空振りしていない", () => {
    expect(files).toBeGreaterThan(MIN_FILES);
    expect(blocks).toBeGreaterThan(MIN_BLOCKS);
    expect(docBlocks).toBeGreaterThan(MIN_DOC_BLOCKS);
    expect(terms.length, "CONTEXT.md の語の列を読めていない").toBeGreaterThan(0);
  });

  it("TODO と FIXME が issue 番号を持つ", () => {
    expect(found.unnumberedTodo).toEqual([]);
  });

  it("比喩の語を書かない", () => {
    expect(found.metaphor, "関数、経路、検査、判定のうち指している実物の語で書く").toEqual([]);
  });

  it.each([
    ["docStartsWithEmphasis", "説明は要約から書く。強調で始めない"],
    ["manyEmphases", "強調は1つの塊に1か所まで。読み落とすと壊れる1文だけに使う"],
    ["issueReference", "番号でなく理由を書く。追跡が要るなら TODO の形にする"],
    ["retiredTerm", "CONTEXT.md の正の語へ揃える"],
  ] as const)("%s が基準を超えない", (key, advice) => {
    expect(found[key].length, `${advice}\n${found[key].join("\n")}`).toBeLessThanOrEqual(
      BASELINE[key],
    );
  });
});
