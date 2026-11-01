import type { BookLine } from "../model/types";
import type { BookRowLine } from "./rows";

/** 「この先」列に出す中身 */
type BookLineLabel = {
  text: string;
  /** 定跡がその手の先へ続いているか。色の出し分けに使う。行き止まりと読めない行は偽 */
  continues: boolean;
  /** 読み上げと `title` に出す説明。`text` だけでは足りないものにだけ付く */
  hint?: string;
};

/**
 * 辿った結果を「この先」列の中身にする。
 *
 * `baseTesuu` は現局面までに指された手数。画面に出すのは、棋譜の手数と突き合わせられる
 * 絶対の手数で、`baseTesuu` に辿った手数を足す。
 *
 * `switch` は全部の状態を書く。`BookRowLine` に状態を足すと tsc が落ちるので、
 * 「まだ」と「辿れなかった」が同じ綴りになることを型で止める。
 */
export function bookLineLabel(line: BookRowLine, baseTesuu: number): BookLineLabel {
  switch (line.state) {
    case "pending":
      return { text: "…", continues: false, hint: "定跡の先を辿っています" };

    case "failed":
      return {
        text: "—",
        continues: false,
        hint: "この局面の先を辿れませんでした。局面を動かすと引き直します",
      };

    case "walked":
      return walkedLabel(line.line, baseTesuu);
  }
}

function walkedLabel(line: BookLine, baseTesuu: number): BookLineLabel {
  if (line.stopped === "brokenMove") {
    return {
      text: "読めない手",
      continues: false,
      hint: "定跡に書かれている手をこの局面に当てられない。ファイルが壊れているか、別の初期配置に向けて作成された定跡",
    };
  }

  // 辿れたのが最初の1手だけなら、その手は定跡にあるが、指した先は載っていない
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
