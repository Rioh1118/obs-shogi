import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, scssFiles } from "./walk";
import type { Bucket, Finding } from "./scssScale";
import { BUCKETS, EXEMPT_MARKER, scan } from "./scssScale";

/**
 * 直値の残り件数。
 *
 * `exempt` 以外の7つは**下げる方向にだけ動かす**。直値をトークンへ寄せたら減らす。
 * `exempt` は逆で、印を1つ足すごとに増える。元の枠が1減って `exempt` が1増えるので、
 * 2行を同じコミットで動かすことになる。
 */
const BASELINE: Record<Bucket, number> = {
  "font-size": 197,
  "border-radius": 139,
  spacing: 434,
  elevation: 48,
  motion: 67,
  family: 10,
  indirect: 49,
  exempt: 10,
};

/** トークンの定義そのものなので、直値があって当然のファイル */
const TOKEN_SOURCE = join(SRC, "index.scss");

function emptyCounts(): Record<Bucket, number> {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<Bucket, number>;
}

function emptySamples(): Record<Bucket, string[]> {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, [] as string[]])) as Record<
    Bucket,
    string[]
  >;
}

const counts = emptyCounts();
const samples = emptySamples();

// describe の本体で走らせると、SCSS が1本壊れただけでこのファイルの検査が
// すべて collect error になる。壊れたファイルを名指しできる形で1つの it に閉じる
beforeAll(() => {
  for (const file of scssFiles(SRC)) {
    let findings: Finding[];
    try {
      findings = scan(readFileSync(file, "utf8"), {
        tokenSource: file === TOKEN_SOURCE,
        from: file,
      });
    } catch (error) {
      throw new Error(`${relative(REPO_ROOT, file)} を解析できない: ${String(error)}`);
    }

    for (const { bucket, line, text } of findings) {
      counts[bucket] += 1;
      if (samples[bucket].length < 5) {
        samples[bucket].push(`${relative(REPO_ROOT, file)}:${line}  ${text}`);
      }
    }
  }
});

/** `$name: ...` の定義。`@use` の名前空間があるので同名でもコンパイルは通る */
const VARIABLE_DEFINITION = /^\s*\$([\w-]+)\s*:/gm;

function definedIn(file: string): Set<string> {
  const names = new Set<string>();
  for (const match of readFileSync(file, "utf8").matchAll(VARIABLE_DEFINITION)) {
    names.add(match[1]);
  }
  return names;
}

/** `index.$name` の参照。`@use "@/index.scss" as index` の名前空間を通るものだけ */
const TOKEN_REFERENCE = /\bindex\.\$([\w-]+)/g;

describe("SCSS のトークン名", () => {
  /**
   * **`npm run verify` は SCSS をコンパイルしない**（`tsc -b` + lint + vitest + test:hooks）。
   * 未定義のトークンを参照しても型でも lint でもテストでも赤くならず、
   * `vite build` まで行って初めて `Undefined variable.` で止まる。
   * つまりコミットの gate を素通りして、**アプリが起動しない状態で緑になる。**
   *
   * 実際に起きた（`e245c7e5` が `$error-fallback-width` を参照だけして定義しなかった）ので、
   * ここで名前の解決だけを見る。コンパイルより速く、この故障をちょうど捕まえる。
   */
  it("参照しているトークンが `index.scss` に実在する", () => {
    const tokens = definedIn(TOKEN_SOURCE);
    const missing = scssFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(TOKEN_REFERENCE)]
        .map((match) => match[1])
        .filter((name) => !tokens.has(name))
        .map((name) => `${relative(REPO_ROOT, file)}  index.$${name}`),
    );

    expect(
      missing,
      [
        "`index.scss` に無いトークンを参照している。**`vite build` が Undefined variable で止まる。**",
        "`npm run verify` はコンパイルしないので、ここが無いと gate を素通りする。",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * **カスタムプロパティの値に Sass の変数を素で書かない。**
   *
   * `--x: rgba(index.$c, 0.1)` はコンパイルを通るが、Sass は custom property の値を
   * **そのままの文字列**として出す。`var(--x)` は無効値になり、その宣言だけが
   * 黙って落ちる（面が透明に、枠が `0px none` に）。`vite build` も緑、
   * 上の「トークンが実在するか」も緑 —— **どの門にも掛からない。**
   *
   * `#{}` で包めば値として評価される。見るのはそこだけ。
   */
  it("カスタムプロパティの値で Sass の変数が補間されている", () => {
    const RAW = /^\s*--[\w-]+:\s*([^;]*);/gm;
    const bare = scssFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(RAW)]
        .map((match) => match[1]!)
        // `#{...}` の中は評価される。外に残った `index.$` だけを見る
        .filter((value) => /index\.\$/.test(value.replace(/#\{[^}]*\}/g, "")))
        .map((value) => `${relative(REPO_ROOT, file)}  ${value.trim()}`),
    );

    expect(
      bare,
      [
        "カスタムプロパティの値に Sass の変数が素で入っている。",
        "**`var()` が無効値になり、その宣言だけが黙って落ちる**（コンパイルは通る）。",
        "`#{}` で包むこと。",
        ...bare,
      ].join("\n"),
    ).toEqual([]);
  });

  it("ファイルローカルの変数がトークンと同名にならない", () => {
    const tokens = definedIn(TOKEN_SOURCE);
    const collisions = scssFiles(SRC)
      .filter((file) => file !== TOKEN_SOURCE)
      .flatMap((file) =>
        [...definedIn(file)]
          .filter((name) => tokens.has(name))
          .map((name) => `${relative(REPO_ROOT, file)}  $${name}`),
      );

    expect(
      collisions,
      [
        "トークンと同名のローカル変数がある。名前空間が違うのでコンパイルは通るが、",
        "同じ名前が同じファイルの中で別の値を持つ。トークンへ寄せる置換で値が黙って変わる。",
        ...collisions,
      ].join("\n"),
    ).toEqual([]);
  });
});

function guidance(bucket: Bucket, actual: number): string {
  if (bucket === "exempt") {
    return [
      `${EXEMPT_MARKER} の印が付いた宣言が基準値 ${BASELINE[bucket]} 件に対して ${actual} 件ある。`,
      `印を1つ足したなら、元の枠を1減らしてこの数を ${actual} に上げること。`,
      `この枠に寄せ先のトークンは無い。印そのものが妥当かをレビューで見るための枠。`,
    ].join("\n");
  }
  return [
    `${bucket} の直値が基準値 ${BASELINE[bucket]} 件に対して ${actual} 件ある。`,
    `増えたなら src/index.scss のトークンを使うこと（ADR-0003）。`,
    `どの宣言を足したかは git diff で見ること。`,
    `減ったなら BASELINE を ${actual} に下げること。`,
    `スケールに載らない寸法は ${EXEMPT_MARKER} の印で exempt の枠へ移せるが、`,
    `枠を移すだけで数は消えないので、exempt の行も一緒に動かすことになる。`,
  ].join("\n");
}

describe("SCSS のスケール", () => {
  for (const bucket of BUCKETS) {
    it(`${bucket} の直値が基準値と一致する`, () => {
      expect(
        counts[bucket],
        [
          guidance(bucket, counts[bucket]),
          `--- この枠の例（走査順の先頭。あなたが足した行とは限らない） ---`,
          ...samples[bucket],
        ].join("\n"),
      ).toBe(BASELINE[bucket]);
    });
  }
});
