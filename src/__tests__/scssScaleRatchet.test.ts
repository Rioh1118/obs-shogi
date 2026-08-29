import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Bucket, BUCKETS, EXEMPT_MARKER, scan } from "./scssScale";

/**
 * 直値の残り件数。**下げる方向にだけ動かす。**
 * 直値をトークンへ寄せたらこの数を減らす。増やす変更は通さない。
 * `exempt` も枠の1つなので、除外の印を増やすにもこの表を触ることになる。
 */
const BASELINE: Record<Bucket, number> = {
  "font-size": 252,
  "border-radius": 178,
  spacing: 528,
  elevation: 79,
  motion: 81,
  family: 18,
  indirect: 53,
  exempt: 0,
};

const SRC = join(process.cwd(), "src");

/** トークンの定義そのものなので、直値があって当然のファイル */
const TOKEN_SOURCE = join(SRC, "index.scss");

function scssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scssFiles(path);
    return entry.name.endsWith(".scss") ? [path] : [];
  });
}

function countRawDeclarations(): {
  counts: Record<Bucket, number>;
  samples: Record<Bucket, string[]>;
} {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const samples = Object.fromEntries(BUCKETS.map((b) => [b, []])) as Record<Bucket, string[]>;

  for (const file of scssFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const { bucket, line, text } of scan(source, {
      tokenSource: file === TOKEN_SOURCE,
    })) {
      counts[bucket] += 1;
      if (samples[bucket].length < 5) {
        samples[bucket].push(`${relative(process.cwd(), file)}:${line}  ${text}`);
      }
    }
  }

  return { counts, samples };
}

/** `$name: ...` の定義。`@use` の名前空間があるので同名でもコンパイルは通る */
const VARIABLE_DEFINITION = /^\s*\$([\w-]+)\s*:/gm;

function definedIn(file: string): Set<string> {
  const names = new Set<string>();
  for (const match of readFileSync(file, "utf8").matchAll(VARIABLE_DEFINITION)) {
    names.add(match[1]);
  }
  return names;
}

describe("SCSS のトークン名", () => {
  it("ファイルローカルの変数がトークンと同名にならない", () => {
    const tokens = definedIn(TOKEN_SOURCE);
    const collisions = scssFiles(SRC)
      .filter((file) => file !== TOKEN_SOURCE)
      .flatMap((file) =>
        [...definedIn(file)]
          .filter((name) => tokens.has(name))
          .map((name) => `${relative(process.cwd(), file)}  $${name}`),
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

/**
 * `no-restricted-imports` は静的な import 文しか見ない。
 * `await import("@/…")` と `vi.mock("@/…")` はレイヤ規則を素通りするので、
 * ここは文字列として拾う
 */
describe("レイヤに依存しない検査の置き場", () => {
  it("src/__tests__ がアプリのコードを参照しない", () => {
    const here = join(SRC, "__tests__");
    const offenders = readdirSync(here)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => {
        const matches = readFileSync(join(here, name), "utf8").matchAll(
          /["'`]@\/(app|pages|widgets|features|entities|shared)\//g,
        );
        return [...matches].map((match) => `${name}  ${match[0]}`);
      });

    expect(
      offenders,
      [
        "src/__tests__ はレイヤに依存しない検査だけを置く場所。",
        "静的 import は lint が止めるが、動的 import と vi.mock は素通りする。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("SCSS のスケール", () => {
  const { counts, samples } = countRawDeclarations();

  for (const bucket of BUCKETS) {
    it(`${bucket} の直値が基準値と一致する`, () => {
      expect(
        counts[bucket],
        [
          `${bucket} の直値が基準値 ${BASELINE[bucket]} 件に対して ${counts[bucket]} 件ある。`,
          `増えたなら src/index.scss のトークンを使うこと（ADR-0003）。`,
          `どの宣言を足したかは git diff で見ること。`,
          `減ったなら BASELINE を ${counts[bucket]} に下げること。`,
          `スケールに載らない寸法は ${EXEMPT_MARKER} の印で exempt の枠へ移せるが、`,
          `枠を移すだけで数は消えないので、この表も一緒に動かすことになる。`,
          `--- 既存の直値の例（走査順の先頭。あなたが足した行とは限らない） ---`,
          ...samples[bucket],
        ].join("\n"),
      ).toBe(BASELINE[bucket]);
    });
  }
});
