import type { BookLine } from "../model/types";

/** 「この先」列に出す中身 */
type BookLineLabel = {
  text: string;
  /**
   * 定跡がその手の先へ続いているか。**色の出し分けに使う。**
   *
   * 行き止まりと読めない行は、どちらも「その先は無い」ので `false`
   */
  continues: boolean;
  /** 読み上げと `title` に出す説明。`text` だけでは足りないものにだけ付く */
  hint?: string;
};

/**
 * 辿った結果を「この先」列の中身にする。
 *
 * `baseTesuu` は現局面までに指された手数。定跡が切れる手数はこれに
 * 辿った手数を足したもので、**画面に出すのは相対ではなく絶対の手数**
 * （棋譜の手数と突き合わせられる形にする）。
 *
 * `line` が `null` なのは**まだ辿り終えていない**とき。辿るのは引くより
 * 桁違いに重いので、候補手が出てから遅れて届く。
 */
export function bookLineLabel(line: BookLine | null, baseTesuu: number): BookLineLabel {
  if (line === null) return { text: "…", continues: false, hint: "定跡の先を辿っています" };

  if (line.stopped === "brokenMove") {
    return {
      text: "読めない手",
      continues: false,
      hint: "定跡に書かれている手をこの局面に当てられない。ファイルが壊れているか、別の初期配置に向けて作られた定跡",
    };
  }

  // 辿れたのが最初の1手だけ＝その手は定跡にあるが、指した先は載っていない
  if (line.plies <= 1 && line.stopped === "outOfBook") {
    return { text: "行き止まり", continues: false };
  }

  const tesuu = baseTesuu + line.plies;

  if (line.stopped === "depthCap") {
    return {
      text: `${tesuu}手目以降`,
      continues: true,
      hint: "辿る手数の上限に当たった。定跡はまだ続いている可能性がある",
    };
  }

  return { text: `→ ${tesuu}手目`, continues: true };
}
