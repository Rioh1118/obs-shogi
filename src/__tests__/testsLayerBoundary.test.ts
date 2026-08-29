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
