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

  it("間に別の警告が挟まれば、同じ文言でも積む", () => {
    const p = warn("place", 1);
    let s = push(initialState, p);
    s = push(s, warn("file", 1));
    s = push(s, { ...p });
    expect(s.warns).toHaveLength(3);
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
