import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./sourceText";
import { REPO_ROOT, rustRoots, SRC, sourceFiles } from "./walk";

/** 門番とその検査。シェルだが、表が関数名を仕様として引く */
const HOOKS = join(REPO_ROOT, ".claude/hooks");

/**
 * docs がバッククォートで指す**識別子**が実在するかを見る検査の本体。
 * パスを見る `docsSourcePaths.ts` の隣。あちらはファイル、こちらは名前。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。
 */

/**
 * 拾う綴り。**下線を1つ以上含むか、大文字の切れ目を持つもの。**
 *
 * 下線か大文字の切れ目を要求するのは、表の記号（`A3` / `E11` / `G0`）と頭字語
 * （`USI` / `SFEN` / `KIF`）を除くため。長さで切ると `USI` は落とせても `SFEN` が残り、
 * 記号の桁数が増えるとまた拾い始める。**綴りの規則なので、桁数と違って後から破れない。**
 *
 * **camelCase も見る。** このリポジトリで実際に腐るのは TS 側の綴りなので、
 * 下線だけを見ると肝心のところが空く。
 */
const IDENTIFIER =
  /^([A-Z][A-Z0-9]*(_[A-Z0-9]+)+|[a-z][a-z0-9]*(_[a-z0-9]+)+|[a-z][a-z0-9]*([A-Z][A-Za-z0-9]*)+)$/;

/**
 * 拾わない綴り。ソースに無くて当然のもの。
 *
 * 増やすときは**なぜソースに無くてよいか**を1件ずつ書くこと。
 * 説明を書けないなら、それは腐った doc であって除外の対象ではない。
 */
/// **他実装の綴りを免除するリストは、走査範囲ごとに3つある。**
/// ここは `docs/**` のバッククォート、`state_table_terms.rs` の `NOT_IDENTIFIERS` は
/// 状態遷移表の表本体、`comment_identifiers.rs` の `EXEMPT` は Rust のコメント。
/// **綴りの形と、どこに書いたかの掛け算で、要るリストが決まる** ——
/// 大文字＋下線を表に書けば前2つ、Rust のコメントにも書けば3つとも要る。
/// 片方にしか要らない綴りが現に在る（`peek_text` は3つ目だけ）。
const EXEMPT = new Set([
  // USI の語。エンジンとの取り決めであって、こちらの識別子ではない
  "go_ponder",
  "position_sfen",
  // ShogiHome（TypeScript）の定数。定跡の表が「あちらはこう書く」の出典に引く
  "SCORE_NONE",
  "DEPTH_NONE",
  // やねうら王（C++）の綴り。同じく本家との差の出典
  "get_number",
  "line_buffer",
  // YaneuraOu-ScriptCollection（Python）の関数。局面数の数え方の出典
  "count_yaneuraou_db_positions",
  // ShogiHome の設定名。対局の表が「あちらの既定」の出典に引く
  "enableEngineTimeout",
  // 検査の名前。ファイル名（`*.test.ts`）としては在るが、ソースの本文には現れない
  "analysisRefusals",
  "docsIdentifiers",
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

  // **シェルもソースに数える。** `verify-gate-decision.md` は門番の関数名
  // （`gate_kinds_for_path` ほか）を仕様として引く。`.claude/hooks/` を外すと、
  // 表が実在する関数を指しているのに「無い」と言われ、直しようが無い。
  //
  // **検査の側も数える。** `expect_kinds` などは判定表が仕様として引く本物の
  // 定義で、外すと表が実在する関数を指しているのに落ちる。代わりに
  // `codeOf` の shell の枝が引用符の中を落とすので、期待値に書いた名前は入らない。
  const hooks = readdirSync(HOOKS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
    .map((entry) => join(HOOKS, entry.name));

  corpus = [
    ...[
      ...sourceFiles(SRC, { includeTests: false }),
      ...rustRoots().flatMap((root) => sourceFiles(root)),
    ].map((path) => codeOf(readFileSync(path, "utf8"))),
    // シェルの行コメントは `#`。`codeOf` の既定（`//`）では落ちない
    ...hooks.map((path) => codeOf(readFileSync(path, "utf8"), "shell")),
  ].join("\n");
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
