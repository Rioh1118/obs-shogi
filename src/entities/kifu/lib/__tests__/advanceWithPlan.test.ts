import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import {
  advanceToLeafWithPlan,
  advanceWithPlan,
  planByTe,
  PLAN_WALK_LIMIT,
} from "../advanceWithPlan";

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
    expect(advanceWithPlan(player, planByTe([]))).toEqual({ moved: true, forkIndex: null });
    expect(player.tesuu).toBe(2);
  });

  test("計画どおり変化に降りると、降りた forkIndex を返す", () => {
    const player = playerAt(1);
    expect(advanceWithPlan(player, planByTe([{ te: 2, forkIndex: 0 }]))).toEqual({
      moved: true,
      forkIndex: 0,
    });
    expect(player.tesuu).toBe(2);
    // 変化は1手で終わるので、本譜（3手）と葉の位置が違う
    expect(advanceWithPlan(player, planByTe([]))).toEqual({ moved: false, forkIndex: null });
  });

  test("計画が実在しない変化を指せば本譜へ落ち、forkIndex は null", () => {
    // 範囲外・負・非整数のいずれでも同じ。負や非整数を forkAndForward に渡すと
    // forks[-1] を掴んで JKFPlayer の内部で TypeError になる。
    for (const forkIndex of [5, -1, 0.5, NaN]) {
      const player = playerAt(1);
      expect(advanceWithPlan(player, planByTe([{ te: 2, forkIndex }]))).toEqual({
        moved: true,
        forkIndex: null,
      });
      expect(player.tesuu).toBe(2);
      // 落ちた先が本譜であることを、変化側（"f2"）と区別できる形で見る
      expect(player.currentStream[2]?.comments).toEqual(["t2"]);
    }
  });

  // 「壊れた計画」と「線の末尾」は結末が違う。前者は本譜へ落ちて1手進み、
  // 後者は forward を呼ばずに返る（= 盤が動かない）。docs/state-transitions/game.md の
  // ※1 がこの違いを持っているので、片方に寄せて読まれないようテストで分ける。
  test("線の末尾より先に計画が残っていても throw せず、1手も動かない", () => {
    // 手が無いのに forkAndForward を呼ぶと「N手目に有効な棋譜がありません」を投げる。
    const player = playerAt(3);
    expect(() => advanceWithPlan(player, planByTe([{ te: 4, forkIndex: 0 }]))).not.toThrow();
    expect(player.tesuu).toBe(3);
    expect(advanceWithPlan(playerAt(3), planByTe([{ te: 4, forkIndex: 0 }]))).toEqual({
      moved: false,
      forkIndex: null,
    });
  });

  test("葉では進まない", () => {
    const player = playerAt(3);
    expect(advanceWithPlan(player, planByTe([]))).toEqual({ moved: false, forkIndex: null });
    expect(player.tesuu).toBe(3);
  });
});

describe("planByTe", () => {
  test("同じ te が重なれば後勝ち", () => {
    const byTe = planByTe([
      { te: 2, forkIndex: 0 },
      { te: 2, forkIndex: 1 },
    ]);
    expect(byTe.get(2)).toBe(1);
  });

  test("undefined は空の表", () => {
    expect(planByTe(undefined).size).toBe(0);
  });
});

describe("advanceToLeafWithPlan", () => {
  test("計画が無ければ本譜の末尾まで", () => {
    const player = playerAt(0);
    advanceToLeafWithPlan(player, planByTe([]));
    expect(player.tesuu).toBe(3);
  });

  test("計画どおり降りた変化の末尾まで", () => {
    const player = playerAt(0);
    advanceToLeafWithPlan(player, planByTe([{ te: 2, forkIndex: 0 }]));
    expect(player.tesuu).toBe(2);
  });

  const lineOf = (length: number) => {
    const moves: JKFMove[] = [mv("root")];
    for (let i = 0; i < length; i += 1) moves.push(mv(`t${i}`));
    return new JKFPlayer({ header: {}, moves });
  };

  test("上限ちょうどの線は葉まで進める", () => {
    const player = lineOf(PLAN_WALK_LIMIT);
    expect(() => advanceToLeafWithPlan(player, planByTe([]))).not.toThrow();
    expect(player.tesuu).toBe(PLAN_WALK_LIMIT);
  });

  test("上限を超える線では throw する", () => {
    expect(() => advanceToLeafWithPlan(lineOf(PLAN_WALK_LIMIT + 1), planByTe([]))).toThrow(
      /overflows/,
    );
  });

  // PLAN_WALK_LIMIT の doc が「goto と足並みは揃わない」と言っている根拠。
  // goto の番人は上限ではなく `0 === c` の等値判定なので、ぴったりの手数だけが
  // 投げて、それより長い線は素通りする。この非単調さを前提に doc を書いてある。
  test("goto はぴったり PLAN_WALK_LIMIT 手のときだけ投げ、それより長いと投げない", () => {
    const gotoResult = (length: number) => {
      const player = lineOf(length);
      try {
        player.goto(length);
        return player.tesuu;
      } catch {
        return "threw";
      }
    };

    expect(gotoResult(PLAN_WALK_LIMIT - 1)).toBe(PLAN_WALK_LIMIT - 1);
    expect(gotoResult(PLAN_WALK_LIMIT)).toBe("threw");
    expect(gotoResult(PLAN_WALK_LIMIT + 1)).toBe(PLAN_WALK_LIMIT + 1);
  });
});
