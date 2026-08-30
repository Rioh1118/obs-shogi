import { readdirSync, readFileSync } from "node:fs";
import { SRC, tsFiles } from "./walk";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/__tests__` はレイヤに属さない。リポジトリ全体の検査だけを置く場所で、
 * `src/**` はデータとして読む。
 *
 * `vite.config.ts` の `no-restricted-imports` は**静的な import 文しか見ない**ので、
 * `await import("@/…")` と `vi.mock("@/…")` は素通りする。ここは文字列として拾う。
 */

const HERE = join(SRC, "__tests__");

/**
 * レイヤは `src/` 直下のディレクトリ。`vite.config.ts` の一覧を写すと、
 * レイヤが増えたときにこちらだけ古いまま緑になる
 */
function layers(): string[] {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "__tests__")
    .map((entry) => entry.name);
}

/** `@/layer/...` と `../layer/...` の両方。相対でもレイヤには届く */
function appReference(names: string[]): RegExp {
  return new RegExp(`["'\`](?:@/|\\.{1,2}/)(${names.join("|")})\\b`, "g");
}

/**
 * 上から下へ。`vite.config.ts` の `no-restricted-imports` と同じ順で、
 * ここでも `src/` 直下から導く（一覧を写さない）
 */
const TOP_DOWN = ["app", "pages", "widgets", "features", "entities", "shared"];

/** レイヤではない `src/` 直下のディレクトリ。import の向きの規則が掛からない */
const NOT_A_LAYER = ["assets"];

/** `name` より上のレイヤ。読んではいけない先 */
function upperLayers(name: string): string[] {
  const at = TOP_DOWN.indexOf(name);
  return at <= 0 ? [] : TOP_DOWN.slice(0, at);
}

describe("レイヤの向き（静的 import の外）", () => {
  /**
   * `no-restricted-imports` は**静的な import 文しか見ない**ので、
   * `await import(...)` と `vi.mock(...)` の文字列は素通りする。
   *
   * テストは動的 import を使う理由（`vi.mock` の巻き上げ）を持つので、
   * 規則の穴はテストの側に開きやすい
   */
  it("動的 import と vi.mock も下向きだけ", () => {
    const offenders: string[] = [];

    for (const layer of TOP_DOWN) {
      const upper = upperLayers(layer);
      if (upper.length === 0) continue;

      const pattern = new RegExp(`["'\`]@/(${upper.join("|")})\\b`, "g");
      for (const file of tsFiles(join(SRC, layer))) {
        for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
          offenders.push(`${relative(SRC, file)}  ${match[0]}`);
        }
      }
    }

    expect(
      offenders,
      [
        "上のレイヤを読んでいる。lint は静的 import しか見ないので素通りする。",
        "その性質が上のレイヤのものなら、テストごとそちらへ置くこと。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * `TOP_DOWN` はレイヤの**順序**を持つので、`src/` から導けない（写すしかない）。
   * 写した一覧が古くなると、上の検査は黙って範囲を狭める。
   *
   * レイヤでないディレクトリは `NOT_A_LAYER` に並べる。並べ忘れると、
   * ここが「知らないディレクトリがある」として落ちる
   */
  it("レイヤの一覧が src/ の実体と合っている", () => {
    const unknown = layers().filter(
      (name) => !TOP_DOWN.includes(name) && !NOT_A_LAYER.includes(name),
    );

    expect(unknown, ["src/ に知らないディレクトリがある。", ...unknown].join("\n")).toEqual([]);
    expect(TOP_DOWN.filter((name) => !layers().includes(name))).toEqual([]);
  });
});

describe("レイヤに依存しない検査の置き場", () => {
  it("src/__tests__ がアプリのコードを参照しない", () => {
    const pattern = appReference(layers());
    const scanned = tsFiles(HERE);
    // 走査が空振りしても「違反0」になる。歩けていることを別に固定する
    expect(scanned.length, "src/__tests__ を歩けていない").toBeGreaterThan(8);

    const offenders = scanned.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(pattern)].map(
        (match) => `${relative(HERE, file)}  ${match[0]}`,
      ),
    );

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
