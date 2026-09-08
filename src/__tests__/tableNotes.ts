/**
 * 状態遷移表の**注（`※N`）**の健全性を見る検査の本体。
 *
 * 表は「本文が `※N` で指し、下の注が答える」形で書かれている。ここが崩れると、
 * 読み手は指し先へ飛べないか、別の話を読む。**人の目では続かない類型**——
 * 注を消しても、指している側は静かに残る。
 *
 * 見るのは1つだけ。**指し先が実在するか。** 内容が正しいかも、誰が指しているかも見ていない。
 *
 * **「誰も指していない注」は見ない。** 走査すると `app.md` と `engine.md` に4件在り、
 * どれも表の外の本文が拾っている形。規約として立っていないので、いま零を要求しない。
 *
 * **昇順は見ない。** `analysis` / `board-orientation` / `engine` / `game-session` /
 * `inline-name-editor` の5つが昇順でないので、規約として立っていない。
 */

/**
 * 定義。**行頭から始まる `※N`。**
 *
 * 箇条書きと強調を許す——表によって `※1 …` と `- **※1**: …` の2通りが在る。
 * どちらも「行の先頭で答えている」形なので、定義として同じに扱う。
 */
const DEFINITION = /^[-*]?[ \t]*\*{0,2}※(\d+)/gm;

/** 1行に当てる版。`/g` は `lastIndex` を持つので `test` に使い回せない */
const DEFINITION_LINE = /^[-*]?[ \t]*\*{0,2}※\d+/;

/**
 * 参照。**行頭以外**に現れる `※N`。
 *
 * 表のセルの中（`…※3`）も、注の本文からの前方参照（`（※7）`）も拾う。
 * 行頭のものは定義なので除く。
 */
const REFERENCE = /※(\d+)/g;

/**
 * 別の表の注を指している行。**同じファイルの定義を要求しない。**
 *
 * 「`file-tree.md` の ※2」のように、他の表へ送る書き方が実在する。
 * 行に `.md` が在れば他所の話と見なす——**同じ行で自分の注も指す形は無い**ので、
 * 行の単位で切って足りる。
 */
const CROSS_FILE = /\.md/;

export type NoteReport = {
  /** 定義の番号を、ファイルに現れる順で */
  defined: number[];
  /** 参照されているのに定義が無い番号 */
  danglingRefs: number[];
};

export function noteReport(markdown: string): NoteReport {
  const defined = [...markdown.matchAll(DEFINITION)].map((m) => Number(m[1]));
  const definedSet = new Set(defined);

  const referenced = new Set(
    [...markdown.matchAll(REFERENCE)]
      .filter((m) => {
        const lineStart = markdown.lastIndexOf("\n", m.index! - 1) + 1;
        const lineEnd = markdown.indexOf("\n", m.index!);
        const line = markdown.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);

        // 他の表の注を指す行は、この表の定義を要求しない
        if (CROSS_FILE.test(line)) return false;

        // **その行の定義そのものだけを外す。** 行ごと外すと、注の本文から
        // 別の注へ送る前方参照（`※1 …（※2）`）まで数えなくなる
        const def = DEFINITION_LINE.exec(line);
        return def === null || lineStart + def[0].length !== m.index! + m[0].length;
      })
      .map((m) => Number(m[1])),
  );

  return {
    defined,
    danglingRefs: [...referenced].filter((n) => !definedSet.has(n)).sort((a, b) => a - b),
  };
}
