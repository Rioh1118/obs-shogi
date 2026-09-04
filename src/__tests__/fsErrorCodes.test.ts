import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUST_SRC, SRC } from "./walk";

/**
 * Rust の `FsErrorCode` が TS の `FsErrorCode` に収まっていることを見る。
 *
 * 収まっていないと `asFsError` の `isFsErrorCode` を通らず `unknown` に落ちる。
 * Rust 側には `FsErrorCode` を網羅 `match` する箇所が1つも無いので、
 * 片側だけ増やしても**どちらのコンパイラも何も言わない**。
 *
 * 両方をデータとして読む。`src/__tests__` はレイヤに依存しない
 * （`testsLayerBoundary.test.ts`）ので import では読めない。
 */

const RUST_ENUM = join(RUST_SRC, "fs", "error.rs");
const TS_CODES = join(SRC, "entities", "file-tree", "api", "error.ts");

/**
 * Rust が返さない code。
 *
 * 棋譜の読み込みは TS 側で失敗し、TS 側で作る。`config_write_failed` は
 * ディスク側の操作と設定の書き戻しが別の Tauri コマンドに分かれていて、
 * 「片方だけ通った」を知っているのが TS 側しかないため
 */
const TS_ONLY = ["kifu_format_unknown", "kifu_parse_failed", "config_write_failed"];

function block(source: string, open: RegExp, from: string): string {
  const start = source.match(open);
  if (start?.index === undefined) throw new Error(`${from} に ${open} が無い`);

  const rest = source.slice(start.index + start[0].length);
  const end = rest.indexOf("}");
  if (end < 0) throw new Error(`${from} の ${open} が閉じていない`);
  return rest.slice(0, end);
}

/** `#[serde(rename_all = "snake_case")]` が付いた enum のシリアライズ名 */
function rustCodes(): string[] {
  const source = readFileSync(RUST_ENUM, "utf8");
  expect(
    source,
    "FsErrorCode の serde 表記が snake_case でなくなると、この検査の前提が崩れる",
  ).toContain('#[serde(rename_all = "snake_case")]');

  return [...block(source, /pub enum FsErrorCode \{/, "error.rs").matchAll(/^\s*(\w+),$/gm)].map(
    (m) => m[1].replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase(),
  );
}

function tsCodes(): string[] {
  const source = readFileSync(TS_CODES, "utf8");
  return [
    ...block(source, /export const FS_ERROR_CODES = \{/, "error.ts").matchAll(
      /^\s*(\w+): true,$/gm,
    ),
  ].map((m) => m[1]);
}

describe("FsErrorCode", () => {
  it("Rust の code が TS の union に全部ある", () => {
    const ts = new Set(tsCodes());
    const missing = rustCodes().filter((code) => !ts.has(code));

    expect(
      missing,
      [
        "Rust だけにある code。TS 側では isFsErrorCode を通らず unknown に落ちる。",
        "src/entities/file-tree/api/error.ts の FsErrorCode に足すこと",
        "（union に足すと describeFsError と fsErrorTier へ型検査が連れて行く）。",
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
