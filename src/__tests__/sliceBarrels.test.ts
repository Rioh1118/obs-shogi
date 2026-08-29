import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * スライスの外から、そのスライスの barrel が公開しているモジュールを
 * 直接読まない。
 *
 * 同じ物が2通りの経路で入ってくると、barrel は公開境界として働かなくなる。
 * 何を公開するかが1箇所で決まらないので、依存の広がりも読めなくなる。
 *
 * 禁止するのは**barrel が実際に公開しているモジュールだけ**。公開していない
 * ものへの深い import は、公開範囲を決めるという別の話なのでここでは見ない。
 *
 * `vi.mock("...")` は素通しする。差し替えるのは実体の側でなければ効かない。
 */

const LAYERS_WITH_SLICES = ["entities", "features", "widgets"];

/** `export * from "./api/error"` / `export { default as X } from "./ui/X"` */
const REEXPORT = /export\s+(?:\*|\{[^}]*\})\s+from\s+["']\.\/([\w./-]+)["']/g;

/** barrel を持つスライスと、そこが公開しているモジュールの `@/` パス */
function publicModules(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const layer of LAYERS_WITH_SLICES) {
    const layerDir = join(SRC, layer);
    for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      let barrel: string;
      try {
        barrel = readFileSync(join(layerDir, entry.name, "index.ts"), "utf8");
      } catch {
        continue;
      }

      const slice = `@/${layer}/${entry.name}`;
      const modules = [...barrel.matchAll(REEXPORT)].map(
        (match) => `${slice}/${match[1].replace(/\.tsx?$/, "")}`,
      );
      if (modules.length > 0) found.set(slice, modules);
    }
  }

  return found;
}

describe("スライスの公開境界", () => {
  it("barrel が公開しているものを、スライスの外から直に読まない", () => {
    const slices = publicModules();
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const name = relative(REPO_ROOT, file);

      for (const [slice, modules] of slices) {
        // スライスの中からは実体を直に読む（barrel を読み返すと循環の種になる）
        if (name.startsWith(slice.replace("@/", "src/"))) continue;

        for (const moduleName of modules) {
          if (!source.includes(`"${moduleName}"`)) continue;
          // 差し替えは実体の側でなければ効かないので、モックは通す
          if (source.includes(`vi.mock("${moduleName}"`)) continue;
          offenders.push(`${name}  ${moduleName}  → "${slice}"`);
        }
      }
    }

    expect(
      offenders,
      [
        "スライスの barrel が公開しているモジュールを、外から直に読んでいる。",
        "同じ物が2通りの経路で入ると、barrel は公開境界として働かない。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
