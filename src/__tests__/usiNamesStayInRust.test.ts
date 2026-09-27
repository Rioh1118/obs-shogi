import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf } from "./sourceText";
import { REPO_ROOT, SRC, rustFile, tsFiles } from "./walk";

/**
 * **TS は評価関数・定跡・解析の固定値の USI の名前を組まない。** どの名前で送るかは Rust が
 * 起動のたびの申告から決める（`src-tauri/src/engine/binding.rs`）。TS が `EvalDir` などを組むと、
 * 申告しないエンジン（`EvalFile` を受ける zermelo）に届かない名前を送る形に戻る。
 *
 * **名前の一覧は Rust から引く**（写しにしない）: `binding.rs` の本番のコードと、`analyzer.rs` の
 * 解析の固定値（`analysis_fixed_values`）の文字列。見るのは TS の**文字列リテラルの中**だけで、
 * コメントで名前を挙げて説明するのは構わない。
 */

/** Rust のコードの `"Name"` の形の文字列（大文字で始まるもの）。`#[cfg(test)]` から先は見ない */
function rustNames(file: string, from = 0, to?: number): string[] {
  const source = readFileSync(file, "utf8");
  const end =
    to ?? (source.indexOf("#[cfg(test)]") >= 0 ? source.indexOf("#[cfg(test)]") : source.length);
  return [...source.slice(from, end).matchAll(/"([A-Z][A-Za-z0-9_]*)"/g)].map((m) => m[1]);
}

function ownedNames(): Set<string> {
  const binding = rustNames(rustFile("engine", "binding.rs"));
  const analyzer = readFileSync(rustFile("engine", "analyzer.rs"), "utf8");
  const start = analyzer.indexOf("fn analysis_fixed_values()");
  const fixed = rustNames(
    rustFile("engine", "analyzer.rs"),
    start,
    analyzer.indexOf("\n}\n", start),
  );
  return new Set([...binding, ...fixed]);
}

/** TS の文字列リテラル（コメントを落としてから）。テンプレートの `${}` は中身ごと読む（雑でよい） */
function tsStrings(body: string): string[] {
  const code = codeOf(body);
  return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

describe("USI の名前は Rust に閉じる", () => {
  it("評価関数・定跡・固定値の名前を TS の文字列で組んでいない", () => {
    const names = ownedNames();
    // 走査が空振りして「0件」になったことを「違反が無い」と読ませない
    expect(names.size, "Rust から名前を拾えていない").toBeGreaterThan(7);
    for (const name of ["EvalDir", "BookFile", "USI_OwnBook", "ConsiderationMode"]) {
      expect(names.has(name), `${name} を拾えていない`).toBe(true);
    }

    const files = tsFiles(SRC, { includeTests: false });
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => {
      const body = readFileSync(file, "utf8");
      const rel = relative(REPO_ROOT, file);
      const inStrings = tsStrings(body)
        .filter((text) => [...names].some((name) => new RegExp(`\\b${name}\\b`).test(text)))
        .map((text) => `${rel}: "${text}"`);
      // 鍵として組む形（`{ EvalDir: path }`）も見る
      const asKeys = [...names]
        .filter((name) => new RegExp(`(^|[{,\\s])${name}\\s*:`).test(codeOf(body)))
        .map((name) => `${rel}: ${name}:`);
      return [...inStrings, ...asKeys];
    });
    expect(
      offenders,
      "TS が USI の名前を組んでいる。評価関数・定跡はパスで渡し、名前は Rust（binding.rs）に決めさせること",
    ).toEqual([]);
  });

  it("文字列と鍵の拾い方そのもの", () => {
    expect(tsStrings('const a = { EvalDir: "x" }; // "BookFile" は説明')).toEqual(["x"]);
    expect(tsStrings("send({ name: `EvalDir`, value })")).toEqual(["EvalDir"]);
  });
});
