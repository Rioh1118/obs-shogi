import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { docsPath } from "./stateTransitionIndex";

/**
 * 境界の名簿を、doc と現物の両方から起こして突き合わせる。
 *
 * `docs/spec/screens/app-layout.md` の「失敗の見せ方」は**段構えの出典**で、
 * `app/App.tsx` と `docs/state-transitions/failure-surfacing.md` が
 * 「ここに写さない」と名指しで委ねている唯一の場所。そこが現物とずれると、
 * 委ねた側は誰も気づけない。
 *
 * **境界を1枚動かすと、表・対象の列挙・コメント・issue 本文の4箇所が別々に腐る。**
 * どれも型でも lint でも赤くならないので、人の注意では止まらない。
 *
 * 見るのは2つ。
 *
 * - **枚数**: 表の行数と `<AppErrorBoundary` の出現数
 * - **名乗り**: 表の「名乗り」列と `label=` の集合
 *
 * 見ないのは「畳まれる範囲」の列。日本語の説明なので機械では突き合わせられない。
 */

/** 表の行。`| 境界 | 名乗り | 畳まれる範囲 |` の3列 */
const TABLE_ROW = /^\|\s*`?[^|]+?`?\s*\|\s*([^|]+?)\s*\|\s*[^|]+?\s*\|\s*$/gm;

/** `label="盤"` の形。境界に必ず1つ付く（必須の prop） */
const LABEL = /<AppErrorBoundary[\s\S]*?label="([^"]+)"/g;

function tableLabels(): string[] {
  const body = readFileSync(docsPath("spec/screens/app-layout.md"), "utf8");
  const start = body.indexOf("| 境界");
  expect(start, "「失敗の見せ方」の境界の表が見つからない").toBeGreaterThan(0);
  const end = body.indexOf("\n\n", start);
  const table = body.slice(start, end);

  return [...table.matchAll(TABLE_ROW)]
    .map((match) => match[1].trim())
    .filter((cell) => cell !== "名乗り" && !/^-+$/.test(cell));
}

function codeLabels(): { label: string; file: string }[] {
  return tsFiles(SRC)
    .filter((file) => !file.includes("__tests__"))
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(LABEL)].map((match) => ({
        label: match[1],
        file: relative(REPO_ROOT, file),
      })),
    );
}

describe("境界の名簿", () => {
  // 表を読めなくなったとき（見出しを変えた・表の形を変えた）に、
  // 0件どうしを比べて緑のまま素通りするのを止める
  it("doc と現物の両方から名簿を起こせている", () => {
    expect(tableLabels().length, "表の行を1つも読めていない").toBeGreaterThan(4);
    expect(codeLabels().length, "`<AppErrorBoundary` を1つも読めていない").toBeGreaterThan(4);
  });

  it("表の名乗りと `label` が一致する", () => {
    const inDoc = [...tableLabels()].sort();
    const inCode = [...new Set(codeLabels().map((entry) => entry.label))].sort();

    expect(
      inCode,
      [
        "`docs/spec/screens/app-layout.md` の「失敗の見せ方」の表と、`label=` の集合が違う。",
        "この表は段構えの出典で、`app/App.tsx` と台帳が「ここに写さない」と委ねている先。",
        "境界を足した／減らした／名乗りを変えたなら、同じコミットで表も直すこと。",
        `doc:  ${inDoc.join(" / ")}`,
        `code: ${inCode.join(" / ")}`,
      ].join("\n"),
    ).toEqual(inDoc);
  });

  it("同じ名乗りを2枚に振っていない", () => {
    const seen = new Map<string, string[]>();
    for (const { label, file } of codeLabels()) {
      seen.set(label, [...(seen.get(label) ?? []), file]);
    }
    const duplicated = [...seen.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([label, files]) => `${label}: ${files.join(" / ")}`);

    expect(
      duplicated,
      [
        "同じ名乗りの境界が2枚ある。**どちらが受けたかを画面からもログからも特定できない。**",
        "内側の1枚を外しても外側が同じ画面で受けるので、退行が見えない。",
        ...duplicated,
      ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * 案内が名指しするボタンの綴りが、実在するボタンと一致するか。
 *
 * `hint` は「…してから『再表示』を押してください。」の形で**ボタンの綴りを本文に埋める**。
 * 手書きにすると、ボタンを改名したときに案内が**存在しないボタン**を名指しする。
 * 落ちた画面はボタンが2つしか無い場所なので、食い違うと利用者は
 * 「そのボタンが出ていない＝別の不具合」と読む。
 *
 * 出典は `RETRY_LABEL`（`shared/ui/AppErrorBoundary.tsx`）の1つだけ。
 */
describe("案内が名指しするボタン", () => {
  /** `hint` に渡す式。属性でもテンプレートリテラルでも拾う */
  const HINT = /hint=\{?([^}\n]*(?:\}[^}\n]*)?)/g;

  const hintExpressions = () =>
    tsFiles(SRC)
      .filter((file) => !file.includes("__tests__"))
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(HINT)].map((match) => ({
          text: match[1],
          file: relative(REPO_ROOT, file),
        })),
      );

  it("`hint` を拾えている", () => {
    expect(hintExpressions().length, "`hint=` を1つも読めていない").toBeGreaterThan(4);
  });

  it("ボタンの綴りを手書きしていない", () => {
    const handwritten = hintExpressions()
      .filter(({ text }) => /「[^」]*(再表示|再読み込み)[^」]*」/.test(text))
      .map(({ file, text }) => `${file}  ${text.trim()}`);

    expect(
      handwritten,
      [
        "案内がボタンの綴りを手書きしている。**ボタンを改名すると、案内だけが**",
        "**存在しないボタンを名指しする**（型でも lint でもテストでも赤くならない）。",
        "`RETRY_LABEL`（`shared/ui/AppErrorBoundary.tsx`）から組むこと。",
        ...handwritten,
      ].join("\n"),
    ).toEqual([]);
  });
});
