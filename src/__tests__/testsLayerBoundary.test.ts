import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/__tests__` はレイヤに属さない。リポジトリ全体の検査だけを置く場所で、
 * `src/**` はデータとして読む。
 *
 * `vite.config.ts` の `no-restricted-imports` は**静的な import 文しか見ない**ので、
 * `await import("@/…")` と `vi.mock("@/…")` は素通りする。ここは文字列として拾う。
 */

const SRC = join(process.cwd(), "src");
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

describe("レイヤに依存しない検査の置き場", () => {
  it("src/__tests__ がアプリのコードを参照しない", () => {
    const pattern = appReference(layers());
    const offenders = readdirSync(HERE, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.tsx?$/.test(name))
      .flatMap((name) =>
        [...readFileSync(join(HERE, name), "utf8").matchAll(pattern)].map(
          (match) => `${name}  ${match[0]}`,
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
