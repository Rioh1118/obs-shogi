import { Piece, type Color } from "shogi.js";
import { isDeadEnd } from "@/shared/lib/shogi/deadEnd";
import { turnSide } from "@/shared/lib/turn";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { BOARD_SIZE } from "../model/board";
import { coordsToShogiNotation } from "./boardCoords";
import { toKan } from "./toKan";
import {
  isCheckOn,
  pieceAt,
  piecesOnBoard,
  squareKey,
  type Square,
} from "./positionDraft";

/**
 * 組んだ局面のうち、将棋の規則に反しているところを挙げる
 *
 * 挙げたものは断りとして見せるだけで、作成は押せるまま。研究のために規則から外れた局面を
 * 組むことがあり、詰将棋は玉が1枚しか無い。同じ理由で玉の枚数は挙げない。
 */

export const POSITION_ISSUE = {
  /** 同じ筋に同じ側の不成の歩が2枚以上 */
  NIFU: "NIFU",
  /** そこから一度も動けない升にいる（歩・香の最終段／桂の最終2段） */
  DEAD_END: "DEAD_END",
  /** 手番でない側の玉に、手番側の利きが通っている */
  CHECK_IGNORED: "CHECK_IGNORED",
  /** 盤に駒が1枚も無い */
  EMPTY_BOARD: "EMPTY_BOARD",
} as const;

export type PositionIssueKind = (typeof POSITION_ISSUE)[keyof typeof POSITION_ISSUE];

export type PositionIssue = {
  kind: PositionIssueKind;
  /** 断りの箇条書きに出す1行。それだけ読んで意味が通ること */
  message: string;
  /** 枠を付ける升。1つの断りが複数の升にかかることがある（二歩） */
  squares: Square[];
};

export type PositionInspection = {
  issues: PositionIssue[];
  /** `squareKey` の集合。升ごとに「枠を付けるか」を引くために持つ */
  illegalSquares: ReadonlySet<string>;
};

function describe(sq: Square): string {
  return coordsToShogiNotation(sq.x, sq.y) ?? `${sq.x},${sq.y}`;
}

function findNifu(state: JKFState): PositionIssue[] {
  const issues: PositionIssue[] = [];
  for (const color of [0, 1] as const) {
    for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
      const squares: Square[] = [];
      for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
        const piece = pieceAt(state, { x, y });
        // と金は二歩に数えない
        if (piece?.kind === "FU" && piece.color === color) squares.push({ x, y });
      }
      if (squares.length < 2) continue;
      issues.push({
        kind: POSITION_ISSUE.NIFU,
        message: `二歩：${x}筋に${turnSide(color)}の歩が${squares.length}枚あります`,
        squares,
      });
    }
  }
  return issues;
}

function findDeadEnds(state: JKFState): PositionIssue[] {
  const issues: PositionIssue[] = [];
  for (const { square, piece } of piecesOnBoard(state)) {
    if (!isDeadEnd(piece.kind, piece.color, square.y)) continue;
    issues.push({
      kind: POSITION_ISSUE.DEAD_END,
      message: `行き所のない駒：${describe(square)}の${turnSide(piece.color)}の${toKan(piece.kind)}は、この先どこへも動けません`,
      squares: [square],
    });
  }
  return issues;
}

/**
 * 盤が空
 *
 * **到達する。** 空盤の SFEN（`9/9/9/9/9/9/9/9/9 b - 1`）は形式として正当なので
 * 種にでき、玉の無い種を選べば盤の駒を全部駒台へ送れる（`canSendToHand` が
 * 弾くのは玉だけ）。初期局面の無い棋譜ができるので、断りに出す。
 */
function findEmptyBoard(state: JKFState): PositionIssue[] {
  if (piecesOnBoard(state).length > 0) return [];
  return [
    {
      kind: POSITION_ISSUE.EMPTY_BOARD,
      // 枠を付ける升は無い。盤が丸ごと空なので、示すべき升が選べない
      message: "盤に駒が1枚もありません",
      squares: [],
    },
  ];
}

function kingSquares(state: JKFState, color: Color): Square[] {
  return piecesOnBoard(state)
    .filter(({ piece }) => piece.kind === "OU" && piece.color === color)
    .map(({ square }) => square);
}

/**
 * 王手放置
 *
 * **両方に玉が1枚ずつあるときだけ挙げる。** 詰将棋には攻め方の玉が無く、
 * そこに「王手がかかったまま」を出すと、正しい局面に断りが出続ける。
 */
function findCheckIgnored(state: JKFState): PositionIssue[] {
  const passive = Piece.oppositeColor(state.color);
  const passiveKings = kingSquares(state, passive);
  if (passiveKings.length !== 1 || kingSquares(state, state.color).length !== 1) return [];
  if (!isCheckOn(state, passive)) return [];

  return [
    {
      kind: POSITION_ISSUE.CHECK_IGNORED,
      message: `王手放置：${turnSide(passive)}の玉が取られる形で、${turnSide(state.color)}の手番になっています`,
      squares: passiveKings,
    },
  ];
}

export function inspectPosition(state: JKFState): PositionInspection {
  const issues = [
    ...findEmptyBoard(state),
    ...findNifu(state),
    ...findDeadEnds(state),
    ...findCheckIgnored(state),
  ];
  const illegalSquares = new Set(issues.flatMap((issue) => issue.squares.map(squareKey)));
  return { issues, illegalSquares };
}
