import { describe, it, expect } from "vitest";

import { pickWarns } from "../pickWarns";

// 2階層以上遡る相対 import は禁止で、自スライスの barrel も中からは読めない。
// 型は口の署名から取る
type Warn = Parameters<typeof pickWarns>[0][number];

function place(n: number): Warn {
  return { kind: "place", path: `/w/${n}`, message: `場所 ${n}` };
}
function file(n: number): Warn {
  return { kind: "file", path: `/w/f${n}.kif`, message: `棋譜 ${n}` };
}

describe("pickWarns", () => {
  /**
   * **新しい順に出すこと。**
   *
   * reducer は末尾に積む。先頭から読むといちばん古い数件が永久に居座り、
   * 後から届いた失敗が一度も描かれない。
   */
  it("新しい順に出す", () => {
    const got = pickWarns([file(1), file(2), file(3)], 2);
    expect(got.map((w) => w.message)).toEqual(["棋譜 3", "棋譜 2"]);
  });

  /**
   * **場所の警告がファイル単位の警告に押し出されないこと。**
   *
   * 1回の再走査は棋譜1件ごとに警告を出しうるので、新しい順に切るだけだと
   * 場所の警告が必ず枠から落ちる。落ちるのは「利用者が次にすること」を
   * 含んだ唯一の文言のほうで、バッジは「更新できていません」としか言えない。
   */
  it("場所の警告はファイルの警告に押し出されない", () => {
    const warns = [place(1), ...Array.from({ length: 20 }, (_, i) => file(i))];
    const got = pickWarns(warns, 5);
    expect(got[0]).toEqual(place(1));
    expect(got).toHaveLength(5);
  });

  /**
   * **場所を名指しできない1本を先頭に出さないこと。**
   *
   * Rust 側は1回の走査で最大3本出し、そのうち1本は `path` が空
   * （どの場所か分からない失敗）。素の新しい順だとそれが先頭に来て、
   * 利用者が動ける手掛かりの無い1本が枠を先に取る。
   */
  it("場所を名指しできる警告を先に出す", () => {
    const unnamed: Warn = { kind: "place", path: "", message: "場所が分かりません" };
    const got = pickWarns([place(1), unnamed], 2);
    expect(got.map((w) => w.path)).toEqual(["/w/1", ""]);
  });

  it("場所の警告どうしも新しい順", () => {
    const got = pickWarns([place(1), file(0), place(2)], 2);
    expect(got.map((w) => w.message)).toEqual(["場所 2", "場所 1"]);
  });
});
