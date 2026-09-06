import { describe, it, expect } from "vitest";

import { initialState, reducer } from "../reducer";
import type { SearchState } from "../types";

type Warn = SearchState["warns"][number];

function warn(kind: Warn["kind"], n: number): Warn {
  return { kind, path: `/w/${kind}${n}`, message: `${kind} ${n}` };
}

function push(state: SearchState, payload: Warn): SearchState {
  return reducer(state, { type: "index_warn", payload });
}

describe("警告の積み方", () => {
  /**
   * **同じ警告を積み増さないこと。**
   *
   * 読めない場所が1つあると、ワークスペースでファイルを保存するたびの
   * 再走査が毎回同じ1件を積む。枠は5つしか無く `pickWarns` は場所を先に取るので、
   * 数回の保存で**同じ文言が枠を埋め尽くし**、棋譜1件ごとの警告が
   * 一度も描かれなくなる。
   */
  it("続けて届いた同じ警告は積まない", () => {
    const p = warn("place", 1);
    let s = push(initialState, p);
    s = push(s, { ...p });
    s = push(s, { ...p });
    expect(s.warns).toHaveLength(1);
  });

  /**
   * **間に別の警告が挟まっても積み増さないこと。**
   *
   * 直前の1件しか見ない形だと、ここが素通りする。1回の再走査は読めない場所に
   * ついて最大3本を出し、そのあいだに棋譜1件ごとの警告も挟まるので、
   * **次の回の同じ3本はどれも直前と別の1件になる**——照合は一度も成立しない。
   */
  it("間に別の警告が挟まっても、同じ警告は積み増さない", () => {
    const p = warn("place", 1);
    let s = push(initialState, p);
    s = push(s, warn("file", 1));
    s = push(s, { ...p });
    expect(s.warns.filter((w) => w.kind === "place")).toHaveLength(1);
    expect(s.warns).toHaveLength(2);
  });

  /**
   * **1回の走査が3本出す形を、回をまたいで繰り返しても増えないこと。**
   *
   * 読めない場所を1つ放置したまま作業すると、保存のたびに再走査が走る。
   * 積み増すと数回で枠が同じ文言の複製だけになり、棋譜の警告が
   * 一度も描かれなくなる。
   */
  it("3本の組を繰り返し受け取っても3本のまま", () => {
    const round = [
      { kind: "place" as const, path: "/w/新規", message: "検索に出ません" },
      { kind: "place" as const, path: "/w/既存", message: "前回のまま残ります" },
      { kind: "place" as const, path: "", message: "場所が分かりません" },
    ];
    let s = initialState;
    for (let r = 0; r < 4; r++) for (const p of round) s = push(s, { ...p });
    expect(s.warns).toHaveLength(3);
  });

  /** 出続けている警告は古い扱いにしない（末尾へ動かす）。 */
  it("また出た警告は新しい側へ動く", () => {
    const p = warn("place", 1);
    let s = push(initialState, p);
    s = push(s, warn("file", 1));
    s = push(s, { ...p });
    expect(s.warns[s.warns.length - 1].kind).toBe("place");
  });

  /**
   * **上限を超えても、場所の警告を落とさないこと。**
   *
   * 総数だけで切ると、1回の再走査が棋譜1件ごとに出す警告が枠を独占する。
   * 落ちるのは「ワークスペースを読めません」のような、**利用者が次にすることを
   * 含んだ唯一の文言**のほう。`pickWarns` が場所を先に取っても、
   * ここで消えていれば取りようがない。
   */
  it("上限を超えても、場所の警告は残る", () => {
    let s = push(initialState, warn("place", 1));
    for (let i = 0; i < 250; i++) s = push(s, warn("file", i));

    expect(s.warns.filter((w) => w.kind === "place")).toHaveLength(1);
    expect(s.warns.length).toBeLessThanOrEqual(200);
  });
});
