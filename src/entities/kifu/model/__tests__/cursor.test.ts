import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import {
  ROOT_CURSOR,
  asBranchPlan,
  cursorKey,
  descendTo,
  normalizeBefore,
  normalizeForkPointers,
  plannedCursorFrom,
  sameForkPointers,
  forkIndexAt,
  makeKifuCursor,
  mergeBranchPlan,
  selectAt,
  truncateFrom,
  type ForkPointer,
  type KifuCursor,
} from "../cursor";

const fp = (te: number, forkIndex: number): ForkPointer => ({ te, forkIndex });

// 手で組むと、makeKifuCursor の正規化を変えても fixture が旧挙動を再現し続ける。
const cursorAt = (tesuu: number, forkPointers: ForkPointer[]): KifuCursor =>
  makeKifuCursor(tesuu, forkPointers, cursorKey({ tesuu, forkPointers }));

describe("selectAt", () => {
  test("te の選択を上書きする", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, 3)).toEqual([fp(2, 3), fp(4, 1)]);
  });

  test("null は te の選択を消す（本譜を選ぶ）", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, null)).toEqual([fp(4, 1)]);
  });

  // 0 は「変化の0番目」であって本譜ではない。取り違えると別の枝が選ばれる。
  test("forkIndex 0 は消さずに書き込む", () => {
    expect(selectAt([fp(2, 1)], 2, 0)).toEqual([fp(2, 0)]);
  });

  test("無い te に null を渡しても壊れない", () => {
    expect(selectAt([fp(2, 0)], 5, null)).toEqual([fp(2, 0)]);
  });

  test("返りは te 昇順", () => {
    expect(selectAt([fp(5, 0), fp(1, 0)], 3, 1)).toEqual([fp(1, 0), fp(3, 1), fp(5, 0)]);
    expect(selectAt([fp(3, 0), fp(1, 0)], 3, 2)).toEqual([fp(1, 0), fp(3, 2)]);
  });
});

describe("forkIndexAt", () => {
  test("計画があればその forkIndex", () => {
    expect(forkIndexAt([fp(2, 1)], 2)).toBe(1);
  });

  test("forkIndex 0 は null にならない", () => {
    expect(forkIndexAt([fp(2, 0)], 2)).toBe(0);
  });

  test("計画が無ければ null（本譜）", () => {
    expect(forkIndexAt([fp(2, 0)], 3)).toBeNull();
  });
});

describe("truncateFrom", () => {
  test("te 以降を捨てる。te そのものも捨てる", () => {
    expect(truncateFrom([fp(1, 0), fp(3, 0), fp(5, 0)], 3)).toEqual([fp(1, 0)]);
  });
});

describe("mergeBranchPlan", () => {
  // 不変条件1: te <= cursor.tesuu の範囲は cursor.forkPointers からしか取らない
  test("カーソル以下の範囲は cursor が勝ち、計画側は無視される", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(2, 9)]);
    expect(merged).toEqual([fp(2, 0)]);
  });

  test("カーソルより先の計画は持ち越す", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(5, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(5, 1)]);
  });

  test("overridePlan もカーソルより先だけ効く", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [], [fp(1, 9), fp(6, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(6, 1)]);
  });

  test("overridePlan は同じ te で prevPlan に勝つ", () => {
    const merged = mergeBranchPlan(cursorAt(1, []), [fp(4, 0)], [fp(4, 1)]);
    expect(merged).toEqual([fp(4, 1)]);
  });
});

describe("cursorKey", () => {
  const at = (tesuu: number, forkPointers: ForkPointer[]) => ({ tesuu, forkPointers });

  // cursorKey が受ける CursorPath は、並び順も te <= tesuu も型では保証されない
  // （previewCursor は handlePrevious のあと te > tesuu を持つ）。
  // 鍵の側で畳まないと、同じ局面を指す2つの CursorPath が別の鍵になる。
  test("並びが違うだけの forkPointers は同じ鍵", () => {
    expect(cursorKey(at(5, [fp(4, 1), fp(2, 0)]))).toBe(cursorKey(at(5, [fp(2, 0), fp(4, 1)])));
  });

  test("tesuu より先の選択は鍵に載らない", () => {
    expect(cursorKey(at(3, [fp(2, 0), fp(5, 1)]))).toBe(cursorKey(at(3, [fp(2, 0)])));
  });

  test("同じ te が重なれば後勝ちで1つに畳む", () => {
    expect(cursorKey(at(5, [fp(2, 0), fp(2, 1)]))).toBe(cursorKey(at(5, [fp(2, 1)])));
  });

  test("違う局面は違う鍵", () => {
    expect(cursorKey(at(5, [fp(2, 0)]))).not.toBe(cursorKey(at(5, [fp(2, 1)])));
    expect(cursorKey(at(5, []))).not.toBe(cursorKey(at(6, [])));
  });

  // 到達したかを確かめる側は、この鍵と再生器が返した tesuuPointer を突き合わせる
  // （buildPlayer の doc がその手順を指している）。書式は JKFPlayer.getTesuuPointer に
  // 従属し、JSON のキーの並び（te → forkIndex）まで一致していないと成り立たない。
  // 手で組んだ文字列と比べると、ライブラリ側が並びを変えても気づけない。
  test("再生器が返す tesuuPointer と同じ書式", () => {
    const player = new JKFPlayer({
      header: {},
      moves: [{}, {}, { comments: ["t2"], forks: [[{ comments: ["f2"] }]] }, {}],
    });
    player.goto(2, [{ te: 2, forkIndex: 0 }]);

    expect(cursorKey(at(2, [fp(2, 0)]))).toBe(player.getTesuuPointer(2));
  });
});

describe("makeKifuCursor", () => {
  // 正規化はここが通す。呼び出し側（cursorFromPlayer）は player の生の値を渡す。
  test("forkPointers を te <= tesuu に正規化する", () => {
    const c = makeKifuCursor(3, [fp(5, 1), fp(2, 0)], "ignored");
    expect(c.forkPointers).toEqual([fp(2, 0)]);
  });

  test("同じ te が重なれば後勝ち", () => {
    expect(makeKifuCursor(5, [fp(2, 0), fp(2, 1)], "x").forkPointers).toEqual([fp(2, 1)]);
  });

  test("tesuuPointer は渡された文字列をそのまま持つ", () => {
    expect(makeKifuCursor(1, [], "5,[]").tesuuPointer).toBe("5,[]");
  });
});

describe("descendTo", () => {
  const at = (tesuu: number, forkPointers: ForkPointer[]) => ({ tesuu, forkPointers });

  test("te の選択を書き、tesuu は te になる", () => {
    expect(descendTo(at(1, []), 2, 0)).toEqual({ tesuu: 2, forkPointers: [fp(2, 0)] });
  });

  // te の選択を変えた以上、その先は別の枝に対して作られた値なので捨てる。
  // 残すと利用者が一度も見ていない変化に盤が入る。
  test("te 以降の選択は落とす", () => {
    expect(descendTo(at(9, [fp(2, 0), fp(5, 1), fp(7, 0)]), 5, 0)).toEqual({
      tesuu: 5,
      forkPointers: [fp(2, 0), fp(5, 0)],
    });
  });

  // null は「本譜を選ぶ」。0 は「変化の0番目」であって本譜ではない。
  test("forkIndex が null なら te の選択を消す", () => {
    expect(descendTo(at(9, [fp(2, 0), fp(5, 1)]), 5, null)).toEqual({
      tesuu: 5,
      forkPointers: [fp(2, 0)],
    });
  });

  test("te より手前の選択は残す", () => {
    expect(descendTo(at(1, [fp(1, 0)]), 3, 1).forkPointers).toEqual([fp(1, 0), fp(3, 1)]);
  });

  // 棋譜を開いた直後で state.cursor がまだ無い行から呼ばれる
  test("path が null なら te の選択だけを持つ", () => {
    expect(descendTo(null, 3, 1)).toEqual({ tesuu: 3, forkPointers: [fp(3, 1)] });
  });

  test("path が null で forkIndex も null なら選択を持たない", () => {
    expect(descendTo(null, 3, null)).toEqual({ tesuu: 3, forkPointers: [] });
  });
});

describe("ROOT_CURSOR", () => {
  // tesuuPointer を手書きのリテラルで持っている唯一の定数。書式は
  // JKFPlayer.getTesuuPointer に従属するので、組む側と一致していることを見る。
  test("tesuuPointer は cursorKey が組むものと一致する", () => {
    expect(ROOT_CURSOR.tesuuPointer).toBe(cursorKey(ROOT_CURSOR));
  });

  test("開始局面で選択を持たない", () => {
    expect(ROOT_CURSOR.tesuu).toBe(0);
    expect(ROOT_CURSOR.forkPointers).toEqual([]);
  });
});

describe("normalizeForkPointers", () => {
  test("te 昇順に並べ替える", () => {
    expect(normalizeForkPointers([fp(5, 0), fp(1, 1), fp(3, 0)])).toEqual([
      fp(1, 1),
      fp(3, 0),
      fp(5, 0),
    ]);
  });

  test("同じ te は後勝ちで1つに畳む", () => {
    expect(normalizeForkPointers([fp(2, 0), fp(2, 1)])).toEqual([fp(2, 1)]);
  });

  test("tesuu を渡すと te <= tesuu だけ残す", () => {
    expect(normalizeForkPointers([fp(2, 0), fp(5, 1)], 3)).toEqual([fp(2, 0)]);
  });

  // 境界は te <= tesuu。< にすると、いま入っている変化そのものが落ちる
  test("te === tesuu は残す", () => {
    expect(normalizeForkPointers([fp(3, 0)], 3)).toEqual([fp(3, 0)]);
  });

  test("tesuu を渡さなければ絞らない", () => {
    expect(normalizeForkPointers([fp(9, 0)])).toEqual([fp(9, 0)]);
  });

  test("入力を書き換えない", () => {
    const input = [fp(5, 0), fp(1, 0)];
    normalizeForkPointers(input);
    expect(input).toEqual([fp(5, 0), fp(1, 0)]);
  });
});

describe("normalizeBefore", () => {
  // BranchPointRef の規約「すべて p.te < te」。te そのものを残すと、
  // resolveLine が選び直す対象の分岐点ではなくその中の1本を指す。
  test("te そのものは落とす", () => {
    expect(normalizeBefore([fp(2, 0), fp(3, 1)], 3)).toEqual([fp(2, 0)]);
  });

  test("並べ替えと重複の畳み込みもする", () => {
    expect(normalizeBefore([fp(2, 1), fp(1, 0), fp(2, 0)], 5)).toEqual([fp(1, 0), fp(2, 0)]);
  });

  test("te = 0 なら空", () => {
    expect(normalizeBefore([fp(0, 0)], 0)).toEqual([]);
  });
});

describe("sameForkPointers", () => {
  test("同じ並びなら true", () => {
    expect(sameForkPointers([fp(1, 0), fp(3, 1)], [fp(1, 0), fp(3, 1)])).toBe(true);
  });

  // 並び順つきの列比較。比べる前に normalizeForkPointers を通すのが前提
  test("並び順が違えば false", () => {
    expect(sameForkPointers([fp(3, 1), fp(1, 0)], [fp(1, 0), fp(3, 1)])).toBe(false);
  });

  test("長さが違えば false", () => {
    expect(sameForkPointers([fp(1, 0)], [fp(1, 0), fp(3, 1)])).toBe(false);
  });

  test("forkIndex が違えば false", () => {
    expect(sameForkPointers([fp(1, 0)], [fp(1, 1)])).toBe(false);
  });

  test("どちらも空なら true", () => {
    expect(sameForkPointers([], [])).toBe(true);
  });
});

describe("asBranchPlan", () => {
  // brand を付けるだけ。中身は触らない（正規化する側は mergeBranchPlan）
  test("渡した配列をそのまま返す", () => {
    const fps = [fp(5, 0), fp(1, 0)];
    expect(asBranchPlan(fps)).toBe(fps);
  });
});

describe("plannedCursorFrom", () => {
  test("cursor の tesuu と、渡した計画を組む", () => {
    const planned = plannedCursorFrom(cursorAt(3, [fp(2, 0)]), asBranchPlan([fp(2, 0), fp(7, 1)]));

    expect(planned?.tesuu).toBe(3);
    expect(planned?.forkPointers).toEqual([fp(2, 0), fp(7, 1)]);
  });

  // forkPointers は cursor 側ではなく計画側から取る。cursor から取ると
  // te > tesuu が落ちて「カーソルより先の選択が黙って空になる」
  test("forkPointers は cursor でなく計画から取る", () => {
    const planned = plannedCursorFrom(cursorAt(3, []), asBranchPlan([fp(7, 1)]));
    expect(planned?.forkPointers).toEqual([fp(7, 1)]);
  });

  test("cursor が null なら null", () => {
    expect(plannedCursorFrom(null, asBranchPlan([]))).toBeNull();
  });
});
