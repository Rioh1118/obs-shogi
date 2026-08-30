import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import type { CursorPath } from "@/entities/kifu/model/cursor";
import { getCommentsByCursor, setCommentsByCursorInJkf } from "../comment";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/**
 * 本譜3手。te=2 に2手の変化がぶら下がり、その変化の te=3 にさらに変化がある。
 *
 * 入れ子にしてあるのは、変化に入るたび手数の原点が動くことを見るため。
 * 深い側の手（"g3"）は、絶対手数3・変化の中では添字1にいる。
 */
function kifu(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2"), mv("f3", [[mv("g3")]])]]), mv("t3")],
  };
}

const at = (tesuu: number, forkPointers: CursorPath["forkPointers"] = []): CursorPath => ({
  tesuu,
  forkPointers,
});

describe("getCommentsByCursor", () => {
  test("本譜の手", () => {
    expect(getCommentsByCursor(kifu(), at(2))).toEqual(["t2"]);
  });

  test("開始局面", () => {
    expect(getCommentsByCursor(kifu(), at(0))).toEqual(["root"]);
  });

  test("変化に入った手そのもの", () => {
    // te=2 の分岐を選んだ状態で te=2 を見る。本譜の "t2" ではなく変化の "f2"。
    expect(getCommentsByCursor(kifu(), at(2, [{ te: 2, forkIndex: 0 }]))).toEqual(["f2"]);
  });

  test("変化の中を1手進んだ手", () => {
    expect(getCommentsByCursor(kifu(), at(3, [{ te: 2, forkIndex: 0 }]))).toEqual(["f3"]);
  });

  test("入れ子の変化に入った手", () => {
    const cursor = at(3, [
      { te: 2, forkIndex: 0 },
      { te: 3, forkIndex: 0 },
    ]);
    expect(getCommentsByCursor(kifu(), cursor)).toEqual(["g3"]);
  });

  test("tesuu より先の計画は当たる手を変えない", () => {
    // te=2 の変化を「これから選ぶ」計画として持ったまま te=1 を見ている。
    expect(getCommentsByCursor(kifu(), at(1, [{ te: 2, forkIndex: 0 }]))).toEqual(["t1"]);
  });

  test("実在しない変化を指すカーソルは空", () => {
    expect(getCommentsByCursor(kifu(), at(2, [{ te: 2, forkIndex: 9 }]))).toEqual([]);
  });

  test("線の末尾より先を指すカーソルは空", () => {
    expect(getCommentsByCursor(kifu(), at(9))).toEqual([]);
  });

  test("cursor が無ければ空", () => {
    expect(getCommentsByCursor(kifu(), null)).toEqual([]);
  });
});

describe("setCommentsByCursorInJkf", () => {
  test("変化の中の手に書く", () => {
    const jkf = kifu();
    const res = setCommentsByCursorInJkf(jkf, at(3, [{ te: 2, forkIndex: 0 }]), ["書いた"]);

    expect(res).toEqual({ ok: true, changed: true });
    expect(jkf.moves[2].forks![0][1].comments).toEqual(["書いた"]);
    // 同じ絶対手数の本譜側は巻き添えにしない
    expect(jkf.moves[3].comments).toEqual(["t3"]);
  });

  test("入れ子の変化の手に書く", () => {
    const jkf = kifu();
    const cursor = at(3, [
      { te: 2, forkIndex: 0 },
      { te: 3, forkIndex: 0 },
    ]);
    const res = setCommentsByCursorInJkf(jkf, cursor, ["書いた"]);

    expect(res).toEqual({ ok: true, changed: true });
    expect(jkf.moves[2].forks![0][1].forks![0][0].comments).toEqual(["書いた"]);
  });

  test("解決できないカーソルには書かない", () => {
    const jkf = kifu();
    const res = setCommentsByCursorInJkf(jkf, at(2, [{ te: 2, forkIndex: 9 }]), ["書いた"]);

    expect(res).toEqual({ ok: false, changed: false });
    expect(jkf).toEqual(kifu());
  });

  test("同じ本文なら changed は false", () => {
    const jkf = kifu();
    expect(setCommentsByCursorInJkf(jkf, at(2), ["t2"])).toEqual({ ok: true, changed: false });
  });

  test("空にすると comments ごと消す", () => {
    const jkf = kifu();
    expect(setCommentsByCursorInJkf(jkf, at(2), [])).toEqual({ ok: true, changed: true });
    expect(jkf.moves[2].comments).toBeUndefined();
  });

  test("1要素に混ざった改行は行に分ける", () => {
    const jkf = kifu();
    setCommentsByCursorInJkf(jkf, at(2), ["1行目\n2行目"]);
    expect(jkf.moves[2].comments).toEqual(["1行目", "2行目"]);
  });
});
