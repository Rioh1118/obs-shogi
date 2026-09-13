/**
 * 綴りを探すラチェットが共通で使う前処理。
 *
 * 走査の対象を `walk.ts` が1箇所で決めているのと同じ理由で、**読んだ中身をどう
 * 均すか**もここだけで決める。検査ごとに書くと、片方だけが危ない形のまま残る。
 */

/** 行コメントを落とす。行そのものは残すので、左にあったコードは消えない */
const stripLineComments = (text: string): string => text.replace(/\/\/[^\n]*/g, "");

/**
 * シェルのコメント。**綴りをここ1つにする**——`codeOf` が落とす区間と
 * `commentsOf` が拾う区間が同じでなければ、どちらからも外れる区間が生まれる。
 */
const SHELL_COMMENT = /(^|\n|[ \t])(#(?!!)[^\n]*)/g;

/**
 * シェルのコメントを落とす。
 *
 * **`//` を落とさない。** `sed -E 's/\\$//'` のような本物のコード行が消える。
 * 逆に `#` は `//` を使う言語では文字列や属性に出るので、こちらも混ぜない。
 * 言語ごとに落とすものが違う、というだけの分岐に留める。
 *
 * **語頭の `#` だけを切る。** シェルがコメントと読むのもそこだけで、
 * 語の途中の `#` は展開の一部（`${kinds# }` / `$#`）。行末のコメントも切れる ——
 * 切らないと、行末に書いた名前が corpus に残って「実在する」に戻る。
 *
 * **文字列を先に潰してから来ること**（[`codeOf`] がその順で呼ぶ）。
 * 引用符の中の ` # ` を先に切ると、閉じない引用符が残って後段が壊れる。
 *
 * 行頭の `#!`（shebang）は残す。落としても困らないが、落とす理由も無い。
 */
const stripShellComments = (text: string): string => text.replace(SHELL_COMMENT, "$1");

/**
 * シェルの文字列リテラルを落とす。
 *
 * **検査の期待値がソースになるのを止める。** `verify-gate.test.sh` は
 * `expect_kinds "ts rust" "src-tauri/tests/root_guard.rs"` のように、
 * 検査したい名前を引用符の中に持つ。落とさないと、`root_guard.rs` を消しても
 * その名前が「実在する」に戻る（`__tests__` を外すのと同じ理由）。
 *
 * **関数の定義は残る。** 落とすのは引用符の中だけなので、
 * `expect_kinds() {` のような定義はコードとして数えられる。
 *
 * 1行に閉じるものだけを見る。複数行にまたがる引用は落とさないが、
 * 落とし過ぎて本物のコードを消すより見逃す側へ倒している。
 */
const stripShellStrings = (text: string): string =>
  text.replace(/"[^"\n]*"/g, '""').replace(/'[^'\n]*'/g, "''");

/**
 * ブロックコメントの開始位置。**行頭で開くものだけ**を開始と見なす。
 *
 * 行の途中に現れる同じ並び（グロブを含む文字列リテラルなど）では開かないので、
 * 離れた閉じと組になって本物のコードを飲み込まない。
 */
function openIndex(text: string): number {
  const m = /(^|\n)([ \t]*)\/\*/.exec(text);
  return m ? m.index + m[1].length + m[2].length : -1;
}

/**
 * コメントを落とす。doc が禁じている綴りを名指しするので、そのままだと
 * 説明している側が違反に数えられる。
 *
 * **言語を解析しない。** 素の `String.replace` でブロックを落とす形だと、
 * 文字列リテラル中の同じ並びが遠くの閉じと組になり、その間の本物のコードごと
 * 消える。消えた範囲は検査から外れるので、**違反があっても緑になる**。
 * 文字列を見分けながら1文字ずつ走る形も試したが、JSX の閉じタグや自己閉じタグを
 * 正規表現リテラルの始まりと読んで同じ「黙って消える」に戻る。
 *
 * 落とすのは**区間**であって行ではない。ブロックの閉じの右に書かれたコードも、
 * 1行で開いて閉じたブロックの右側も残る。**行ごと捨てると、そこに載せた綴りが
 * 検査から消える。** 末尾の行コメントも、切るのは `//` から行末までで、
 * 同じ行の左にある呼び出しは検査に残る。
 *
 * 行の途中で開いたブロック（`const a = 1;` の右で開くもの）は開始と見なさないので、
 * その継続行の `*` はコードとして数える。説明文に綴りを書くと**赤くなる**が、
 * 黙って見逃すよりこちらに倒している。落ちた場所は `hitsIn` が行番号で示す。
 */
export const codeOf = (body: string, lang: "c-like" | "shell" = "c-like"): string => {
  if (lang === "shell") return stripShellComments(stripShellStrings(body));

  let out = "";
  let rest = body;

  while (rest.length > 0) {
    const open = openIndex(rest);

    if (open < 0) {
      out += stripLineComments(rest);
      break;
    }

    out += stripLineComments(rest.slice(0, open));

    const close = rest.indexOf("*/", open + 2);
    // 閉じないブロックは末尾まで
    if (close < 0) break;
    rest = rest.slice(close + 2);
  }

  return out;
};

/** 行コメントだけを拾う。`codeOf` の `stripLineComments` の裏返し */
const lineCommentsIn = (text: string): string => (text.match(/\/\/[^\n]*/g) ?? []).join("\n");

/**
 * コメントだけを残す。**`codeOf` の裏返し**で、同じ `openIndex` の規則に従う
 * ——行の途中で開いたブロックは、あちらがコードとして数えるのでこちらも拾わない。
 *
 * **落とす／残すの規則を2通り持たない**のがここに置く理由。片方だけ直すと、
 * コードでもコメントでもない区間が生まれ、どちらの検査からも外れる。
 * 引き手は `srcCommentIdentifiers` と `ownedIdentifiers`。
 *
 * `lang` は `codeOf` と同じ。**シェルにも裏返しが要る**——`.claude/hooks/*.sh` は
 * 検査の名前やパスを「仕様として引く」ので、そこが腐っても赤くならない状態が残る。
 *
 * **シェルには第3の区間が在る。** 引用符の中は `codeOf` も `commentsOf` も落とす
 * （corpus に検査の期待値が混ざるのを止めるため、先に潰している）。
 * シェルのコメントに書いた綴りを検査に載せたいなら、引用符でくくらないこと。
 */
export const commentsOf = (body: string, lang: "c-like" | "shell" = "c-like"): string => {
  // **シェルは同じ綴りの裏返しで取る。** `stripShellComments` が落とす区間が
  // そのままコメントなので、規則を2通り持たずに済む（この関数の doc のとおり）。
  if (lang === "shell") {
    return [...stripShellStrings(body).matchAll(SHELL_COMMENT)].map((m) => m[2]).join("\n");
  }

  let out = "";
  let rest = body;

  while (rest.length > 0) {
    const open = openIndex(rest);

    if (open < 0) {
      out += lineCommentsIn(rest);
      break;
    }

    out += `${lineCommentsIn(rest.slice(0, open))}\n`;

    const close = rest.indexOf("*/", open + 2);
    // 閉じないブロックは末尾まで
    if (close < 0) {
      out += rest.slice(open);
      break;
    }

    out += `${rest.slice(open, close + 2)}\n`;
    rest = rest.slice(close + 2);
  }

  return out;
};

/**
 * 綴りが当たった箇所を `path:行番号` で返す。空なら当たっていない。
 *
 * ファイル名だけを出すと、当たったのが本物のコードなのか、ブロックと
 * 見なされなかった説明文なのかを読み手が判断できない。
 *
 * 行番号は**コメントを落とした後**の並びなので、元のファイルとはずれる。
 * 探す手掛かりとして使うこと。
 */
export function hitsIn(rel: string, body: string, pattern: RegExp): string[] {
  return codeOf(body)
    .split("\n")
    .map((line, i) => (pattern.test(line) ? `${rel}:${i + 1}` : null))
    .filter((hit): hit is string => hit !== null);
}
