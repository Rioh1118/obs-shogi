import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, RUST_CHECKS_DIR, SRC, rustRoots, sourceFiles } from "./walk";

/**
 * ソースが `.claude/plans/` を指していないこと。
 *
 * **計画のファイルは git に載らない**（`.gitignore` が `.claude/plans/` を除く）。clone した読み手の
 * 手元には無いので、「判定表は計画の §3」と書いたコメントは誰にも辿れない。判定表は
 * `docs/state-transitions/` に移し、ソースはそちらを指す。
 */
const PLAN_REFERENCE = /\.claude\/plans\/|[\w-]+\.plan\.md/;

/** 走査が空振りして「0件」になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 300;

describe("ソースが計画のファイルを指していない", () => {
  it("`.claude/plans/` と `*.plan.md` の綴りが無い", () => {
    const files = [SRC, ...rustRoots(), RUST_CHECKS_DIR].flatMap((root) => sourceFiles(root));
    expect(files.length, "走査が空振りしている").toBeGreaterThan(MIN_SCANNED);

    const offenders = files
      .filter((file) => !file.endsWith("noPlanReferences.test.ts"))
      .filter((file) => PLAN_REFERENCE.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));

    expect(
      offenders,
      "計画のファイル（git に載らない）を指している。判定表は docs/state-transitions/ に移して、そちらを指すこと",
    ).toEqual([]);
  });

  it("綴りの判定そのもの", () => {
    expect(PLAN_REFERENCE.test("`.claude/plans/presets-migration.plan.md` の §3")).toBe(true);
    expect(PLAN_REFERENCE.test("`presets-migration.plan.md` §4")).toBe(true);
    expect(PLAN_REFERENCE.test("`docs/state-transitions/presets-file.md`")).toBe(false);
  });
});
