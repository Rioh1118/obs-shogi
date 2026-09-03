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
 * このリポジトリの現物を指す約束があるのは状態遷移表だけなので、
 * そこだけが「実在しなければ腐っている」と言える。
 *
 * **`docs/` 全体へ広げる手順の出典はここ。** 先に落ちるものの種類を数え上げ、
 * 種類ごとに「直す」のか「綴りで見分ける」のかを決める。**検査だけ先に広げると、
 * 直しようのない赤が残る。** いま落ちる種類は次のとおり（件数は書かない。増える）。
 *
 * - **別リポジトリのパス。** `decisions/` / `IDEAS.md` / `PREMISES.md` /
 *   `proposals/` が根拠として引く。書き方は決まっている（外部リンク。
 *   `docs/state-transitions/README.md`）ので、あとは直すだけ
 * - **まだ存在しない自リポジトリの置き場。** `docs/spec/` が「ここに置く」を
 *   予告として書く。**規約はこちらに効かない。** 予告と死んだパスを
 *   綴りで見分ける手が要る
 * - **別ブランチにあった過去のファイル。** `docs/archive/` が元データとして引く。
 *   更新しない約束の記録なので、直すこと自体が筋に合わない。走査から外すか、
 *   これも綴りで見分ける
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

  // 落とさないと拡張子の検査に当たらず、拾われも赤くもならない
  test("行番号の範囲も落として拾う", () => {
    expect(sourcePathsIn("`src/entities/kifu/lib/comment.ts:42-50`")).toEqual([
      "src/entities/kifu/lib/comment.ts",
    ]);
    expect(sourcePathsIn("`src/entities/kifu/lib/comment.ts#L42-L50`")).toEqual([
      "src/entities/kifu/lib/comment.ts",
    ]);
  });

  test("範囲つきでも実在しなければ missing に出る", () => {
    expect(missingPaths(sourcePathsIn("`src/book/GONE.rs:1-2`"))).toEqual(["src/book/GONE.rs"]);
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
