import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * **発火元の無い購読を残さない。** `analysis-complete` と `engine-error` は購読だけがあり、
 * emit する行が無いまま「この通知は届かない」と注記され続けた。綴りを TS と Rust で
 * 別々に持つので、片方だけ消えても型は止めない。
 */
const SINK = "src-tauri/src/engine/commands/analysis.rs";
const NAMES = "src/entities/engine/api/eventNames.ts";

describe("エンジンの通知の綴り", () => {
  const source = readFileSync(join(REPO_ROOT, SINK), "utf8");
  const emitted = [...source.matchAll(/\.emit\("([^"]+)"/g)].map((m) => m[1]);

  const listened = [...readFileSync(join(REPO_ROOT, NAMES), "utf8").matchAll(/: "([a-z-]+)"/g)].map(
    (m) => m[1],
  );

  test("走査が空振りしていない", () => {
    expect(emitted.length).toBeGreaterThan(0);
    expect(listened.length).toBeGreaterThan(0);
  });

  test("購読している綴りは全部 Rust が emit し、emit している綴りは全部購読している", () => {
    expect([...emitted].sort()).toEqual([...listened].sort());
  });
});
