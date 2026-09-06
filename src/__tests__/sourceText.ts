/**
 * 綴りを探すラチェットが共通で使う前処理。
 *
 * 走査の対象を `walk.ts` が1箇所で決めているのと同じ理由で、**読んだ中身をどう
 * 均すか**もここだけで決める。検査ごとに書くと、片方だけが危ない形のまま残る。
 */

/** 行コメントを落とす。行そのものは残すので、左にあったコードは消えない */
const stripLineComments = (text: string): string => text.replace(/\/\/[^\n]*/g, "");

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
export const codeOf = (body: string): string => {
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
