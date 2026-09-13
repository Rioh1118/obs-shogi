import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustFile, SRC } from "./walk";

/**
 * Rust の `BookErrorCode` が TS の `BookErrorCode` に収まっていることを見る。
 *
 * 収まっていないと `asBookError` の `isBookErrorCode` を通らず `unknown` に落ち、
 * **段（`bookNoticeTier`）まで `danger` の既定に流れる。** Rust 側には
 * `BookErrorCode` を網羅 `match` する箇所が1つも無いので、片側だけ増やしても
 * **どちらのコンパイラも何も言わない。**
 *
 * `FsErrorCode` と同じ形（`fsErrorCodes.test.ts`）。両方をデータとして読むのは、
 * `src/__tests__` がレイヤに依存しないため（`testsLayerBoundary.test.ts`）。
 */

const RUST_ENUM = rustFile("book", "error.rs");
const TS_CODES = join(SRC, "entities", "book", "api", "error.ts");

/**
 * Rust が返さない code。
 *
 * **いまは空。** 定跡まわりの失敗はすべて Rust の側で作る（TS 側が自前で
 * 組み立てるのは `asBookError` の `unknown` だけで、それは Rust にも在る）。
 */
const TS_ONLY: string[] = [];

function block(source: string, open: RegExp, from: string): string {
  const start = source.match(open);
  if (start?.index === undefined) throw new Error(`${from} に ${open} が無い`);

  const rest = source.slice(start.index + start[0].length);
  const end = rest.indexOf("}");
  if (end < 0) throw new Error(`${from} の ${open} が閉じていない`);
  return rest.slice(0, end);
}

/**
 * `book_error_codes!` に並んだ綴りを snake_case にしたもの。
 *
 * **マクロの引数を読む。** Rust 側は列挙と `ALL` をこの1つの綴りから作っていて、
 * `pub enum BookErrorCode` の本体はマクロが展開するまで存在しない。
 */
function rustCodes(): string[] {
  const source = readFileSync(RUST_ENUM, "utf8");
  expect(
    source,
    "BookErrorCode の serde 表記が snake_case でなくなると、この検査の前提が崩れる",
  ).toContain('#[serde(rename_all = "snake_case")]');

  return [...block(source, /book_error_codes! \{/, "book/error.rs").matchAll(/^\s*(\w+),$/gm)].map(
    (m) => m[1].replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase(),
  );
}

function tsCodes(): string[] {
  const source = readFileSync(TS_CODES, "utf8");
  return [
    ...block(source, /const BOOK_ERROR_CODES = \{/, "book/api/error.ts").matchAll(
      /^\s*(\w+): true,$/gm,
    ),
  ].map((m) => m[1]);
}

describe("BookErrorCode", () => {
  // 走査が壊れて0件を返しても、両側が空なら一致してしまう
  it("両側から綴りを拾えている", () => {
    expect(rustCodes().length).toBeGreaterThan(5);
    expect(tsCodes().length).toBeGreaterThan(5);
  });

  it("Rust の code が TS の一覧に全部ある", () => {
    const ts = new Set(tsCodes());
    const missing = rustCodes().filter((code) => !ts.has(code));

    expect(
      missing,
      [
        "Rust だけにある code。TS 側では isBookErrorCode を通らず unknown に落ちる。",
        "src/entities/book/api/error.ts の BOOK_ERROR_CODES と、",
        "src/entities/book/model/types.ts の BookErrorCode に足すこと。",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });

  it("TS だけにある code は、Rust が返さないと分かっているものだけ", () => {
    const rust = new Set(rustCodes());
    const extra = tsCodes().filter((code) => !rust.has(code) && !TS_ONLY.includes(code));

    expect(
      extra,
      [
        "Rust に無い code が TS にある。Rust 側の変種を消したなら TS からも消すこと。",
        "TS 側だけで作る code なら、この検査の TS_ONLY に理由と一緒に並べること。",
        ...extra,
      ].join("\n"),
    ).toEqual([]);
  });
});
