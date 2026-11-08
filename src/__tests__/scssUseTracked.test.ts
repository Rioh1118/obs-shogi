import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC } from "./walk";

/**
 * **`src/index.scss` が `@use` で読む `src/` の外のファイルは、git に追跡されていること。**
 *
 * 値の正本はデザインシステムの生成物（`design-system/dist/scss/_tokens.scss`）で、
 * 根の `.gitignore` は `dist` を無視する。手元にファイルがあればビルドも検査も通るので、
 * 追跡されていないことに気づくのは、新しく取り出した CI でビルドが落ちたときになる。
 */
describe("index.scss が読む外のファイル", () => {
  it("git に追跡されている", () => {
    const source = readFileSync(join(SRC, "index.scss"), "utf8");
    const paths = [...source.matchAll(/@use\s+"(\.\.\/[^"]+)"/g)].map((m) => m[1]);

    expect(paths.length, "`@use` で外のファイルを読んでいない。読み方が変わったならこの検査を直す").toBeGreaterThan(0);

    const untracked = paths
      .map((p) => {
        const dir = dirname(resolve(SRC, p));
        const base = basename(p);
        return relative(REPO_ROOT, join(dir, `_${base}.scss`));
      })
      .filter((file) => {
        const listed = execFileSync("git", ["ls-files", "--", file], { cwd: REPO_ROOT, encoding: "utf8" });
        return listed.trim() === "";
      });

    expect(untracked, "生成物をコミットすること（根の `.gitignore` の `dist` に当たっていないか）").toEqual([]);
  });
});
