import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { missingPaths, sourcePathsIn } from "./docsSourcePaths";

/**
 * 状態遷移表がバッククォートで指すソースのパスが実在するかを見る。
 *
 * 置き場を動かすと doc が死んだパスを指したまま残る。読み手はそこを開いて空振りし、
 * どこに移ったのかは doc からは分からない。人の注意では止まらないので機械で見る。
 *
 * `docs/` 全体ではなく状態遷移表に絞るのは、ADR と `IDEAS.md` / `PREMISES.md` が
 * **別リポジトリ（ShogiHome）のパス**を根拠として引くため（3件。`src/background/book/` ほか）。
 * このリポジトリの現物を指す約束があるのは状態遷移表だけなので、
 * そこだけが「実在しなければ腐っている」と言える。
 * 他リポジトリのパスを外部リンクの形で書く規約にすれば `docs/` 全体へ広げられる。
 */
describe("状態遷移表が指すソースのパス", () => {
  const tableFiles = () => markdownFiles().filter((f) => f.startsWith("state-transitions/"));

  // 置き場が動いたとき、この検査が0件を見て緑のまま素通りするのを止める。
  // 空回りする検査は、無いより悪い（「見ている」と誤解させる）
  test("状態遷移表を拾えている", () => {
    expect(tableFiles().length).toBeGreaterThan(3);
  });

  test("実在しないパスを指していない", () => {
    const broken = tableFiles().flatMap((relative) => {
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

describe("接頭辞の扱い", () => {
  // 表は接頭辞を省いても書く。絞りすぎると拾われず黙って緑になる
  test("レイヤ名で始まる綴りは src/ を補って解決する", () => {
    expect(sourcePathsIn("`entities/kifu/model/cursor.ts`")).toEqual([
      "src/entities/kifu/model/cursor.ts",
    ]);
  });

  test("補っても実在しないなら、その綴りを missing として返す", () => {
    const found = sourcePathsIn("`entities/kifu/model/GONE.ts`");

    expect(missingPaths(found)).toEqual(["entities/kifu/model/GONE.ts"]);
  });

  // 相対リンクは doc どうしの参照。追うと丁寧に書いた人だけが赤くなる
  test("相対リンクは拾わない", () => {
    expect(sourcePathsIn("`./branch-index.md` `../decisions/0003-x.md`")).toEqual([]);
  });

  // ソースでない綴りに接頭辞を試すと、触ってもいないものが赤くなる
  test("レイヤ名でも起点でもない綴りは拾わない", () => {
    expect(sourcePathsIn("`example.com/a.html`")).toEqual([]);
  });

  test("起点から書いたものは実在を要求する", () => {
    expect(missingPaths(sourcePathsIn("`src/entities/kifu/model/GONE.ts`"))).toEqual([
      "src/entities/kifu/model/GONE.ts",
    ]);
  });
});
