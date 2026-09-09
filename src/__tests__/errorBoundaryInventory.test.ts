import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
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
 * **現物の側は `BOUNDARY_LABELS`（`shared/ui/AppErrorBoundary.tsx`）だけを読む。**
 * JSX から `label="..."` を正規表現で拾う形にすると、`label={X}` と書いた1枚を
 * 読み飛ばして次の境界の名乗りを拾い、**枚数も対応も静かにずれる。**
 * 綴りが実在することは `BoundaryLabel` 型が保証するので、ここで見るのは
 * 「表と一致するか」と「1つの鍵を2箇所で使っていないか」の2つ。
 *
 * 見ないのは「畳まれる範囲」の列。日本語の説明なので機械では突き合わせられない。
 */

/** 表の行。`| 境界 | 名乗り | 畳まれる範囲 |` の3列 */
const TABLE_ROW = /^\|\s*`?[^|]+?`?\s*\|\s*([^|]+?)\s*\|\s*[^|]+?\s*\|\s*$/gm;

/** `BOUNDARY_LABELS` の中身。`  root: "アプリ",` の形 */
const LABEL_ENTRY = /^\s{2}(\w+): "([^"]+)",$/gm;

const BOUNDARY_SOURCE = join(SRC, "shared/ui/AppErrorBoundary.tsx");

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

/** 名簿の定数から `{ 鍵: 名乗り }` を起こす */
function declaredLabels(): { key: string; label: string }[] {
  const body = readFileSync(BOUNDARY_SOURCE, "utf8");
  const start = body.indexOf("export const BOUNDARY_LABELS");
  expect(start, "`BOUNDARY_LABELS` が見つからない").toBeGreaterThan(0);
  const block = body.slice(start, body.indexOf("} as const;", start));

  return [...block.matchAll(LABEL_ENTRY)].map((match) => ({ key: match[1], label: match[2] }));
}

/** `BOUNDARY_LABELS.board` の使われ方を、テストを除いた `src/` から数える */
function usageCounts(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const { key } of declaredLabels()) seen.set(key, []);

  for (const file of tsFiles(SRC)) {
    if (file.includes("__tests__")) continue;
    if (file === BOUNDARY_SOURCE) continue;
    const body = readFileSync(file, "utf8");
    for (const [key, files] of seen) {
      const uses = body.split(`BOUNDARY_LABELS.${key}`).length - 1;
      for (let at = 0; at < uses; at += 1) files.push(relative(REPO_ROOT, file));
    }
  }
  return seen;
}

describe("境界の名簿", () => {
  // 表を読めなくなったとき（見出しを変えた・表の形を変えた）に、
  // 0件どうしを比べて緑のまま素通りするのを止める
  it("doc と定数の両方から名簿を起こせている", () => {
    expect(tableLabels().length, "表の行を1つも読めていない").toBeGreaterThan(4);
    expect(declaredLabels().length, "`BOUNDARY_LABELS` の行を1つも読めていない").toBeGreaterThan(4);
  });

  it("表の名乗りと `BOUNDARY_LABELS` が一致する", () => {
    const inDoc = [...tableLabels()].sort();
    const inCode = declaredLabels()
      .map((entry) => entry.label)
      .sort();

    expect(
      inCode,
      [
        "`docs/spec/screens/app-layout.md` の「失敗の見せ方」の表と、`BOUNDARY_LABELS` が違う。",
        "この表は段構えの出典で、`app/App.tsx` と台帳が「ここに写さない」と委ねている先。",
        "境界を足した／減らした／名乗りを変えたなら、同じコミットで表も直すこと。",
        `doc:  ${inDoc.join(" / ")}`,
        `code: ${inCode.join(" / ")}`,
      ].join("\n"),
    ).toEqual(inDoc);
  });

  it("1つの鍵を2箇所で使っていない", () => {
    const wrong = [...usageCounts().entries()]
      .filter(([, files]) => files.length !== 1)
      .map(
        ([key, files]) =>
          `${key}: ${files.length === 0 ? "どこからも使われていない" : files.join(" / ")}`,
      );

    expect(
      wrong,
      [
        "**同じ名乗りの境界が2枚あると、どちらが受けたかを画面からもログからも特定できない。**",
        "内側の1枚を外しても外側が同じ画面で受けるので、退行が見えない。",
        "使われていない鍵は、境界を外したのに名簿と表が残っている合図。",
        ...wrong,
      ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * 案内が名指しするボタンの綴りが、実在するボタンと一致するか。
 *
 * 案内（`hint`）は「…してから『再表示』を押してください。」の形で**ボタンの綴りを本文に埋める**。
 * 手書きにすると、ボタンを改名したときに案内が**存在しないボタン**を名指しする。
 * 落ちた画面はボタンが2つしか無い場所なので、食い違うと利用者は
 * 「そのボタンが出ていない＝別の不具合」と読む。
 *
 * 出典は `RETRY_LABEL`（`shared/ui/error-fallback/ErrorFallbackBody.tsx`）の1つだけ。
 */
describe("案内が名指しするボタン", () => {
  /** 出典そのもの。ここだけが綴りを持ってよい */
  const SOURCE = join(SRC, "shared/ui/error-fallback/ErrorFallbackBody.tsx");

  const sources = () => tsFiles(SRC).filter((file) => !file.includes("__tests__"));

  it("走査する対象を拾えている", () => {
    expect(sources().length, "`src/` の `.ts`/`.tsx` を1つも読めていない").toBeGreaterThan(100);
    expect(
      readFileSync(SOURCE, "utf8").includes(`RETRY_LABEL = "再表示"`),
      "出典の綴りが変わった。ここを直すなら、この走査が見る綴りも一緒に直すこと",
    ).toBe(true);
  });

  it("出口の表が、いまのボタンを名指ししている", () => {
    // `docs/spec/screens/app-layout.md` の「出口は3つ」の表は、この綴りで出口を並べている。
    // 改名すると、実在しないボタンの名前で「全部の境界が持つ」と書いた表だけが残る
    expect(
      readFileSync(docsPath("spec/screens/app-layout.md"), "utf8"),
      "出口の表が、いまのボタンの綴りを名指ししていない",
    ).toContain("再表示");
  });

  it("ボタンの綴りを写していない", () => {
    const copied = sources()
      .filter((file) => file !== SOURCE)
      .filter((file) => readFileSync(file, "utf8").includes("再表示"))
      .map((file) => relative(REPO_ROOT, file));

    expect(
      copied,
      [
        "ボタンの綴りを写している。**ボタンを改名すると、写した側だけが**",
        "**存在しないボタンを名指しする**（型でも lint でもテストでも赤くならない）。",
        "`RETRY_LABEL`（`shared/ui/error-fallback/ErrorFallbackBody.tsx`）から組むこと。",
        ...copied,
      ].join("\n"),
    ).toEqual([]);
  });
});
