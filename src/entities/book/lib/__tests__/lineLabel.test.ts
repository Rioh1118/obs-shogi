import { describe, expect, test } from "vitest";
import type { BookWalkStop } from "@/entities/book/model/types";
import type { BookRowLine } from "../rows";
import { bookLineLabel } from "../lineLabel";

const line = (plies: number, stopped: BookWalkStop = "outOfBook"): BookRowLine => ({
  state: "walked",
  line: { usiMove: "7g7f", plies, stopped },
});

describe("「この先」列", () => {
  /**
   * **手数は絶対で出す。** 相対（あと N 手）だと、棋譜の手数と突き合わせられない。
   * 5手目の局面から 9 手辿れたなら 14 手目。
   */
  test("定跡が切れる手数を、現局面までの手数に足して出す", () => {
    expect(bookLineLabel(line(9), 5).text).toBe("→ 14手目");
    expect(bookLineLabel(line(9), 5).continues).toBe(true);
  });

  test("その手の先が定跡に無いなら行き止まり", () => {
    const label = bookLineLabel(line(1), 5);

    expect(label.text).toBe("行き止まり");
    expect(label.continues).toBe(false);
  });

  /**
   * **上限に当たったのと、定跡が切れたのを混ぜない。**
   * 混ぜると、まだ続いている定跡が「そこで終わり」に見える。
   */
  test("上限に当たったときは、まだ続きうることが出る", () => {
    const label = bookLineLabel(line(64, "depthCap"), 5);

    expect(label.text).toBe("69手目以降");
    expect(label.continues).toBe(true);
    expect(label.hint).toContain("上限");
  });

  /** 読めない手は行き止まりと別物。**ファイルが壊れていることが出る** */
  test("当てられない手は、理由つきで出る", () => {
    const label = bookLineLabel(line(0, "brokenMove"), 5);

    expect(label.text).toBe("読めない手");
    expect(label.continues).toBe(false);
    expect(label.hint).toBeTruthy();
  });

  /** **黙って空にしない**（`book-view.md` 不変条件2） */
  test("まだ辿り終えていない行にも中身が出る", () => {
    const label = bookLineLabel({ state: "pending" }, 5);

    expect(label.text).not.toBe("");
    expect(label.hint).toBeTruthy();
  });

  /**
   * **辿るのをやめた後に「辿っています」と言わない。**
   *
   * 同じ綴りにすると、利用者は重い処理がまだ走っていると読んで待ち続ける。
   * 待っても局面を動かすまで解けない。
   */
  test("辿れなかった行は、まだ辿っている行と別の綴りになる", () => {
    const failed = bookLineLabel({ state: "failed" }, 5);
    const pending = bookLineLabel({ state: "pending" }, 5);

    expect(failed.text).not.toBe(pending.text);
    expect(failed.hint).not.toBe(pending.hint);
    expect(failed.hint).not.toContain("辿っています");
    expect(failed.continues).toBe(false);
  });
});
