import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { missingPaths, sourcePathsIn } from "./docsSourcePaths";

/**
 * 状態遷移表がバッククォートで指すソースのパスが実在するかを見る。
 *
 * 置き場を動かすと doc が死んだパスを指したまま残る。読み手はそこを開いて空振りし、
 * どこに移ったのかは doc からは分からない。**この故障は #279 の中で3回起きた**
 * （`entities/game/lib/cursor.ts` → `entities/kifu/lib/cursorRuntime.ts` →
 * `entities/kifu/lib/branchPlan.ts` と、直すたびに別の死んだパスになった）ので、
 * 人の注意ではなく機械で見る。
 *
 * `docs/` 全体ではなく状態遷移表に絞るのは、ADR と `IDEAS.md` / `PREMISES.md` が
 * **作らないと決めたもの**のパスを書くため（例: `decisions/0002-drop-book-read-write.md`
 * の `src/background/book/`）。そこを実在させろと言うのは記録の書き換えになる。
 * 状態遷移表は現物の実装を指す約束なので、実在しなければ腐っている。
 */
describe("状態遷移表が指すソースのパス", () => {
  test("実在しないパスを指していない", () => {
    const broken = markdownFiles()
      .filter((relative) => relative.startsWith("state-transitions/"))
      .flatMap((relative) => {
        const body = readFileSync(docsPath(relative), "utf8");
        return missingPaths(sourcePathsIn(body)).map((p) => `${relative}: ${p}`);
      });

    expect(broken).toEqual([]);
  });
});

describe("sourcePathsIn", () => {
  test("バッククォートの中の src/ を拾う", () => {
    expect(sourcePathsIn("実装は `src/entities/kifu/model/cursor.ts` にある")).toEqual([
      "src/entities/kifu/model/cursor.ts",
    ]);
  });

  test("src-tauri も拾う", () => {
    expect(sourcePathsIn("`src-tauri/src/lib.rs`")).toEqual(["src-tauri/src/lib.rs"]);
  });

  test("末尾のディレクトリ指定も拾う", () => {
    expect(sourcePathsIn("`src/widgets/kifu-stream/`")).toEqual(["src/widgets/kifu-stream/"]);
  });

  test("行番号は落として拾う", () => {
    expect(sourcePathsIn("`src/entities/kifu/lib/comment.ts:42`")).toEqual([
      "src/entities/kifu/lib/comment.ts",
    ]);
  });

  // 地の文まで拾うと、説明のために書いたディレクトリ名で落ちる
  test("バッククォートの外は拾わない", () => {
    expect(sourcePathsIn("src/entities/kifu あたりに置く")).toEqual([]);
  });

  test("拡張子もスラッシュも無いものは拾わない", () => {
    expect(sourcePathsIn("`src/entities/kifu`")).toEqual([]);
  });

  test("同じパスが何度出ても1つ", () => {
    expect(sourcePathsIn("`src/index.scss` と `src/index.scss`")).toEqual(["src/index.scss"]);
  });
});
