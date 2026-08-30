import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { advanceToLeafWithPlan, advanceWithPlan, indexPlan } from "../advanceWithPlan";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/**
 * 本譜3手。te=2 に**1手だけ**の変化がぶら下がる。
 *
 * 変化の長さを本譜と変えてあるのは、「計画どおり降りた葉」（2）と
 * 「本譜へ落ちた葉」（3）を別の値で区別するため。
 */
function kifu(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2")]]), mv("t3")],
  };
}

const playerAt = (tesuu: number) => {
  const p = new JKFPlayer(kifu());
  p.goto(tesuu);
  return p;
};

describe("advanceWithPlan", () => {
  test("計画が無ければ本譜を1手進む", () => {
    const player = playerAt(1);
    expect(advanceWithPlan(player, indexPlan([]))).toEqual({ moved: true, forkIndex: null });
    expect(player.tesuu).toBe(2);
  });

  test("計画どおり変化に降りると、降りた forkIndex を返す", () => {
    const player = playerAt(1);
    expect(advanceWithPlan(player, indexPlan([{ te: 2, forkIndex: 0 }]))).toEqual({
      moved: true,
      forkIndex: 0,
    });
    expect(player.tesuu).toBe(2);
    // 変化は1手で終わるので、本譜（3手）と葉の位置が違う
    expect(advanceWithPlan(player, indexPlan([]))).toEqual({ moved: false, forkIndex: null });
  });

  test("計画が実在しない変化を指せば本譜へ落ち、forkIndex は null", () => {
    // 範囲外・負・非整数のいずれでも同じ。負や非整数を forkAndForward に渡すと
    // forks[-1] を掴んで JKFPlayer の内部で TypeError になる。
    for (const forkIndex of [5, -1, 0.5, NaN]) {
      const player = playerAt(1);
      expect(advanceWithPlan(player, indexPlan([{ te: 2, forkIndex }]))).toEqual({
        moved: true,
        forkIndex: null,
      });
      expect(player.tesuu).toBe(2);
      // 落ちた先が本譜であることを、変化側（"f2"）と区別できる形で見る
      expect(player.currentStream[2]?.comments).toEqual(["t2"]);
    }
  });

  test("線の末尾より先に計画が残っていても throw しない", () => {
    // 手が無いのに forkAndForward を呼ぶと「N手目に有効な棋譜がありません」を投げる。
    const player = playerAt(3);
    expect(() => advanceWithPlan(player, indexPlan([{ te: 4, forkIndex: 0 }]))).not.toThrow();
    expect(advanceWithPlan(playerAt(3), indexPlan([{ te: 4, forkIndex: 0 }]))).toEqual({
      moved: false,
      forkIndex: null,
    });
  });

  test("葉では進まない", () => {
    const player = playerAt(3);
    expect(advanceWithPlan(player, indexPlan([]))).toEqual({ moved: false, forkIndex: null });
    expect(player.tesuu).toBe(3);
  });
});

describe("indexPlan", () => {
  test("同じ te が重なれば後勝ち", () => {
    const index = indexPlan([
      { te: 2, forkIndex: 0 },
      { te: 2, forkIndex: 1 },
    ]);
    expect(index.get(2)).toBe(1);
  });

  test("undefined は空の索引", () => {
    expect(indexPlan(undefined).size).toBe(0);
  });
});

describe("advanceToLeafWithPlan", () => {
  test("計画が無ければ本譜の末尾まで", () => {
    const player = playerAt(0);
    advanceToLeafWithPlan(player, indexPlan([]));
    expect(player.tesuu).toBe(3);
  });

  test("計画どおり降りた変化の末尾まで", () => {
    const player = playerAt(0);
    advanceToLeafWithPlan(player, indexPlan([{ te: 2, forkIndex: 0 }]));
    expect(player.tesuu).toBe(2);
  });

  test("上限を超える線では throw する", () => {
    const moves: JKFMove[] = [mv("root")];
    for (let i = 0; i < 10001; i += 1) moves.push(mv(`t${i}`));
    const player = new JKFPlayer({ header: {}, moves });

    expect(() => advanceToLeafWithPlan(player, indexPlan([]))).toThrow(/overflows/);
  });
});
