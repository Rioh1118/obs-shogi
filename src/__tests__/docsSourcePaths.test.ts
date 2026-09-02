import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { lineNumberRefsIn, missingPaths, sourcePathsIn } from "./docsSourcePaths";

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

/**
 * `docs/` の**全部**が行番号で指さないこと。
 *
 * パスの実在は状態遷移表だけに絞ってよい（ADR は別リポジトリのパスを引くので、
 * 実在を要求できない）。**行番号のほうは絞る理由が無い。** 自リポジトリを
 * 行番号で指せば、どこに書いてあっても無言でずれる。
 *
 * 実際、状態遷移表の32件を落とした同じ変更で、ADR-0004 が
 * 消えた関数名と行番号を指したまま残った。あの ADR は「どの失敗がどの段か」の
 * 唯一の持ち主で、`failure-surfacing.md` がそこへ委譲している。
 *
 * 指したいものがあるなら識別子で指すこと（`docsIdentifiers` がそちらを見る）。
 */
describe("docs が行番号で指していないこと", () => {
  /**
   * 別リポジトリの行番号を引くファイル。
   *
   * **こちらの変更ではずれない**ので、腐り方が違う。引く側が版を書いて
   * 追えるようにする約束にすれば、この免除は外せる。
   *
   * 増やすときは「なぜ自リポジトリを指していないか」を書けるときだけ。
   */
  const EXEMPT = new Map([
    ["PREMISES.md", "YaneuraOu の `source/book/book.h` を根拠として引く"],
    ["decisions/0002-drop-book-read-write.md", "同上。定跡の実装を捨てた根拠"],
  ]);

  test("免除が現物を指している", () => {
    const all = new Set(markdownFiles());
    const dead = [...EXEMPT.keys()].filter((f) => !all.has(f));

    expect(dead, "免除が実在しないファイルを指している。消したなら免除も消すこと").toEqual([]);
  });

  test("行番号で指していない", () => {
    const refs = markdownFiles()
      .filter((relative) => !EXEMPT.has(relative))
      .flatMap((relative) => {
        const body = readFileSync(docsPath(relative), "utf8");
        return lineNumberRefsIn(body).map((r) => `${relative}: ${r}`);
      });

    expect(refs, "行番号は無言でずれる。識別子で指すこと").toEqual([]);
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

describe("lineNumberRefsIn", () => {
  /**
   * 綴りはパス側と1つを共有する。
   *
   * 割れると片方だけが狭くなる。実際、パス側が `#L12` を落としているのに
   * 行番号側は `:42` しか見ておらず、`#L` の形は両方を通り抜けた。
   */
  test.each([
    ["`bridge.rs:117`", "コロンと数字"],
    ["`provider.tsx:19-24`", "範囲"],
    ["`provider.tsx:38, 49`", "並べたもの"],
    ["`protocol.rs#L24`", "GitHub 由来の #L"],
    ["`protocol.rs:L24`", "コロンと L"],
    ["`AnalysisPaneHeader:84`", "拡張子の無い識別子"],
  ])("%s を拾う（%s）", (markdown) => {
    expect(lineNumberRefsIn(markdown)).toHaveLength(1);
  });

  test.each([
    ["`src/entities/kifu/model/cursor.ts`", "行番号の無いパス"],
    ["`cursorFromPlayer`", "識別子だけ"],
    ["`03:00`", "時刻"],
    ["バッククォートの外の bridge.rs:117", "囲まれていない"],
  ])("%s は拾わない（%s）", (markdown, _why) => {
    expect(lineNumberRefsIn(markdown)).toEqual([]);
  });
});
