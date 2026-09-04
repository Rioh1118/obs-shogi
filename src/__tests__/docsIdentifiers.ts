import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./sourceText";
import { REPO_ROOT, rustRoots, SRC, sourceFiles } from "./walk";

/**
 * docs がバッククォートで指す**識別子**が実在するかを見る検査の本体。
 * パスを見る `docsSourcePaths.ts` の隣。あちらはファイル、こちらは名前。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。
 */

/**
 * 拾う綴り。**下線を1つ以上含むものだけ。**
 *
 * 下線を要求するのは、表の記号（`A3` / `E11` / `G0`）と頭字語（`USI` / `SFEN` / `KIF`）を
 * 除くため。長さで切ると `USI` は落とせても `SFEN` が残り、記号の桁数が増えると
 * また拾い始める。**下線の有無は綴りの規則なので、桁数と違って後から破れない。**
 */
const IDENTIFIER = /^([A-Z][A-Z0-9]*(_[A-Z0-9]+)+|[a-z][a-z0-9]*(_[a-z0-9]+)+)$/;

/**
 * 拾わない綴り。ソースに無くて当然のもの。
 *
 * 増やすときは**なぜソースに無くてよいか**を1件ずつ書くこと。
 * 説明を書けないなら、それは腐った doc であって除外の対象ではない。
 */
const EXEMPT = new Set([
  // USI の語。エンジンとの取り決めであって、こちらの識別子ではない
  "go_ponder",
  "position_sfen",
]);

/**
 * ソースを1つの文字列として持つ。識別子が現れるかだけを見るので、構文解析はしない。
 *
 * **コメントを落としてから数える**（`codeOf`）。落とさないと、腐った名前を
 * 説明のために引いたコメント1行が、その名前を「実在する」に戻す。
 *
 * **`__tests__` を外す。** テストの期待値には「消えた名前」を書くのが正当な用途で
 * （改名を捕まえられることを固定するため）、それは文字列リテラルなので
 * `codeOf` では落ちない。外さないと、検査が自分の固定値を根拠に緑を返す。
 * `walk.ts` が「テスト中の言及を実装として数えると答えが変わる検査だけ外す」と
 * 書いている、その一例。
 */
let corpus: string | null = null;

function sourceCorpus(): string {
  if (corpus !== null) return corpus;

  corpus = [
    ...sourceFiles(SRC, { includeTests: false }),
    ...rustRoots().flatMap((root) => sourceFiles(root)),
  ]
    .map((path) => codeOf(readFileSync(path, "utf8")))
    .join("\n");
  return corpus;
}

/** バッククォートの中の識別子を拾う。`running_clock()` の括弧は落とす */
export function identifiersIn(markdown: string): string[] {
  const found = new Set<string>();

  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const bare = inline.replace(/\(\)$/, "");
    if (!IDENTIFIER.test(bare)) continue;
    if (EXEMPT.has(bare)) continue;
    found.add(bare);
  }

  return [...found].sort();
}

/**
 * ソースに1度も現れないものだけを返す。
 *
 * **見るのは綴りが在るかだけ。** 種類（関数か定数か欄名か）も、指している対象が
 * 合っているかも見ていない。**限界は4つある。**
 *
 * 1. **別の場所に同じ綴りが在る改名は素通りする。** 関数名を変えても、
 *    その綴りが構造体の欄名として残っていれば緑になる
 * 2. **型名・バリアント名は1つも見ていない。** `IDENTIFIER` が下線を要求するので
 *    `ClocksView` や `Aborted` は候補にすら入らない
 * 3. 語境界で照合するので接尾辞を足す改名（`FOO` → `STOP_FOO`）は拾えるが、
 *    `Foo::Bar` の `Bar` 側は 2 の理由で拾えない
 * 4. **Rust のコメントが指す識別子は見ていない。** 見るのは `docs/**` だけ
 */
export function missingIdentifiers(identifiers: string[]): string[] {
  return missingIn(identifiers, sourceCorpus());
}

/**
 * 判定の本体。テストからも直に引ける。
 *
 * **部分一致では見ない。** `includes` だと、消えた `FOO` が生きている
 * `STOP_FOO` の一部として見つかって緑になる。接尾辞や接頭辞を足す改名は
 * 最も普通の形なので、そこが抜けると検査の意味が大きく減る。
 */
export function missingIn(identifiers: string[], source: string): string[] {
  return identifiers.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));
}

export function docsPath(relative: string): string {
  return join(REPO_ROOT, "docs", relative);
}
