import { describe, expect, test } from "vitest";
import { Color, type Kind } from "shogi.js";
import {
  POSITION_ISSUE,
  inspectPosition,
  squareKey,
  type PositionInspection,
  type PositionIssue,
  type PositionIssueKind,
} from "../inspectPosition";
import { emptyHand, stateFromPreset } from "../positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";

type Placement = [x: number, y: number, kind: Kind, color: Color];

function boardOf(placements: Placement[], turn: Color = Color.Black): JKFState {
  const state: JKFState = {
    color: turn,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({}))),
    hands: [emptyHand(), emptyHand()],
  };
  for (const [x, y, kind, color] of placements) {
    state.board[x - 1][y - 1] = { kind, color };
  }
  return state;
}

function kindsOf(state: JKFState): PositionIssueKind[] {
  const inspection: PositionInspection = inspectPosition(state);
  return inspection.issues.map((issue: PositionIssue) => issue.kind);
}

/** 両側に玉が1枚ずつある形。王手放置の検査はこれが揃ってはじめて働く */
const BOTH_KINGS: Placement[] = [
  [1, 1, "OU", Color.White],
  [9, 9, "OU", Color.Black],
];

describe("inspectPosition", () => {
  test("平手に断りは出ない", () => {
    expect(inspectPosition(stateFromPreset("HIRATE")).issues).toEqual([]);
  });

  test("駒落ちにも断りは出ない", () => {
    for (const preset of ["KY", "2", "6", "10"] as const) {
      expect(inspectPosition(stateFromPreset(preset)).issues).toEqual([]);
    }
  });

  test("断りが出ない局面では枠を付ける升も空", () => {
    expect(inspectPosition(stateFromPreset("HIRATE")).illegalSquares.size).toBe(0);
  });
});

describe("二歩", () => {
  test("同じ筋に同じ側の歩が2枚あると出る", () => {
    const state = boardOf([
      [5, 5, "FU", Color.Black],
      [5, 7, "FU", Color.Black],
    ]);
    expect(kindsOf(state)).toEqual([POSITION_ISSUE.NIFU]);
  });

  test("枚数と筋が文言に出る", () => {
    const state = boardOf([
      [5, 3, "FU", Color.Black],
      [5, 5, "FU", Color.Black],
      [5, 7, "FU", Color.Black],
    ]);
    expect(inspectPosition(state).issues[0].message).toBe("5筋に先手の歩が3枚あります（二歩）");
  });

  test("該当する歩の升を全部返す", () => {
    const state = boardOf([
      [5, 5, "FU", Color.Black],
      [5, 7, "FU", Color.Black],
    ]);
    expect(inspectPosition(state).illegalSquares).toEqual(new Set(["5,5", "5,7"]));
  });

  test("先後が違えば同じ筋に2枚あってもよい", () => {
    const state = boardOf([
      [5, 5, "FU", Color.Black],
      [5, 4, "FU", Color.White],
    ]);
    expect(kindsOf(state)).toEqual([]);
  });

  test("筋が違えば出ない", () => {
    const state = boardOf([
      [5, 5, "FU", Color.Black],
      [4, 5, "FU", Color.Black],
    ]);
    expect(kindsOf(state)).toEqual([]);
  });

  test("と金は数えない", () => {
    // 二歩は不成の歩どうしの話。と金が並んでいても規則には反しない
    const state = boardOf([
      [5, 5, "FU", Color.Black],
      [5, 7, "TO", Color.Black],
    ]);
    expect(kindsOf(state)).toEqual([]);
  });

  test("後手の二歩も出る", () => {
    const state = boardOf([
      [3, 3, "FU", Color.White],
      [3, 6, "FU", Color.White],
    ]);
    expect(inspectPosition(state).issues[0].message).toBe("3筋に後手の歩が2枚あります（二歩）");
  });
});

describe("行き所のない駒", () => {
  test("先手の歩は一段目で出る", () => {
    const state = boardOf([[5, 1, "FU", Color.Black]]);
    expect(kindsOf(state)).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(inspectPosition(state).issues[0].message).toBe("5一の先手の歩は、そこから動けません");
  });

  test("先手の歩は二段目なら出ない", () => {
    expect(kindsOf(boardOf([[5, 2, "FU", Color.Black]]))).toEqual([]);
  });

  test("後手の歩は九段目で出る", () => {
    const state = boardOf([[5, 9, "FU", Color.White]]);
    expect(kindsOf(state)).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(inspectPosition(state).issues[0].message).toBe("5九の後手の歩は、そこから動けません");
  });

  test("香も歩と同じ段で出る", () => {
    expect(kindsOf(boardOf([[1, 1, "KY", Color.Black]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[1, 9, "KY", Color.White]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[1, 2, "KY", Color.Black]]))).toEqual([]);
  });

  test("桂は最終2段で出る", () => {
    expect(kindsOf(boardOf([[2, 1, "KE", Color.Black]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[2, 2, "KE", Color.Black]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[2, 3, "KE", Color.Black]]))).toEqual([]);
    expect(kindsOf(boardOf([[2, 9, "KE", Color.White]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[2, 8, "KE", Color.White]]))).toEqual([POSITION_ISSUE.DEAD_END]);
    expect(kindsOf(boardOf([[2, 7, "KE", Color.White]]))).toEqual([]);
  });

  test("成っていれば動けるので出ない", () => {
    expect(kindsOf(boardOf([[5, 1, "TO", Color.Black]]))).toEqual([]);
    expect(kindsOf(boardOf([[2, 1, "NK", Color.Black]]))).toEqual([]);
  });

  test("他の駒は最終段でも出ない", () => {
    for (const kind of ["GI", "KI", "KA", "HI", "OU"] as const) {
      expect(kindsOf(boardOf([[5, 1, kind, Color.Black]]))).toEqual([]);
    }
  });

  test("該当する升だけを返す", () => {
    const state = boardOf([
      [5, 1, "FU", Color.Black],
      [4, 5, "FU", Color.Black],
    ]);
    expect(inspectPosition(state).illegalSquares).toEqual(new Set(["5,1"]));
  });
});

describe("王手放置", () => {
  test("手番でない側の玉に利きが通っていると出る", () => {
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [1, 1, "HI", Color.Black],
      ],
      Color.Black,
    );
    expect(kindsOf(state)).toEqual([POSITION_ISSUE.CHECK_IGNORED]);
    expect(inspectPosition(state).issues[0].message).toBe(
      "後手の玉に王手がかかったまま、先手から指す形になっています",
    );
  });

  test("玉の升に枠が付く", () => {
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [1, 1, "HI", Color.Black],
      ],
      Color.Black,
    );
    expect(inspectPosition(state).illegalSquares).toEqual(new Set(["1,9"]));
  });

  test("手番側の玉が王手でも出ない", () => {
    // 手番側は次に逃げられる。規則に反しているのは「指せない側が王手」のときだけ
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [1, 1, "HI", Color.Black],
      ],
      Color.White,
    );
    expect(kindsOf(state)).toEqual([]);
  });

  test("遮る駒があれば出ない", () => {
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [1, 1, "HI", Color.Black],
        [1, 5, "FU", Color.Black],
      ],
      Color.Black,
    );
    expect(kindsOf(state)).toEqual([]);
  });

  test("玉が片方にしか無ければ出ない", () => {
    // 詰将棋には攻め方の玉が無い。ここで断ると正しい局面に断りが出続ける
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [1, 1, "HI", Color.Black],
      ],
      Color.Black,
    );
    expect(kindsOf(state)).toEqual([]);
  });

  test("同じ側に玉が2枚あれば出ない", () => {
    const state = boardOf(
      [
        [1, 9, "OU", Color.White],
        [2, 9, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [1, 1, "HI", Color.Black],
      ],
      Color.Black,
    );
    expect(kindsOf(state)).toEqual([]);
  });

  test("手番を変えると出たり消えたりする", () => {
    const placements: Placement[] = [
      [1, 9, "OU", Color.White],
      [9, 9, "OU", Color.Black],
      [1, 1, "HI", Color.Black],
    ];
    expect(kindsOf(boardOf(placements, Color.Black))).toEqual([POSITION_ISSUE.CHECK_IGNORED]);
    expect(kindsOf(boardOf(placements, Color.White))).toEqual([]);
  });

  test("桂の利きも見る", () => {
    const state = boardOf(
      [
        [5, 3, "OU", Color.White],
        [9, 9, "OU", Color.Black],
        [4, 5, "KE", Color.Black],
      ],
      Color.Black,
    );
    expect(kindsOf(state)).toEqual([POSITION_ISSUE.CHECK_IGNORED]);
  });
});

describe("複数の断り", () => {
  test("同時に出るものは全部並ぶ", () => {
    const state = boardOf(
      [...BOTH_KINGS, [5, 5, "FU", Color.Black], [5, 1, "FU", Color.Black]],
      Color.Black,
    );
    const { issues, illegalSquares } = inspectPosition(state);
    expect(issues.map((i) => i.kind).sort()).toEqual(
      [POSITION_ISSUE.DEAD_END, POSITION_ISSUE.NIFU].sort(),
    );
    expect(illegalSquares).toEqual(new Set(["5,5", "5,1"]));
  });
});

describe("squareKey", () => {
  test("升ごとに違う綴りになる", () => {
    expect(squareKey({ x: 5, y: 1 })).toBe("5,1");
    expect(squareKey({ x: 1, y: 5 })).not.toBe(squareKey({ x: 5, y: 1 }));
  });
});
