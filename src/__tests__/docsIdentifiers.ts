import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./sourceText";
import { REPO_ROOT, RUST_SRC, SRC, sourceFiles } from "./walk";

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
 * 説明のために引いたコメント1行が、その名前を「実在する」に戻してしまう。
 * **この検査自身がそれで空回りした。** テスト側の doc が改名で消えた名前を
 * 例として引いていたので、検査は自分の文章を根拠に緑を返していた。
 */
let corpus: string | null = null;

function sourceCorpus(): string {
  if (corpus !== null) return corpus;

  corpus = [...sourceFiles(SRC), ...sourceFiles(RUST_SRC)]
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
 * 合っているかも見ていない。改名で消えた名前は捕まえられるが、
 * 「欄名として在る綴りを関数として説明している」は素通りする。
 */
export function missingIdentifiers(identifiers: string[]): string[] {
  const source = sourceCorpus();
  return identifiers.filter((name) => !source.includes(name));
}

/** テスト用。任意のソース文字列に対して引く */
export function missingIn(identifiers: string[], source: string): string[] {
  return identifiers.filter((name) => !source.includes(name));
}

export function docsPath(relative: string): string {
  return join(REPO_ROOT, "docs", relative);
}
