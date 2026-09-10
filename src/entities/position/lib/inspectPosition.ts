import { colorToString, type Color, type Kind } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { BOARD_SIZE } from "../model/shogi";
import { coordsToShogiNotation } from "./boardUtils";
import { toKan } from "./toKan";
import { flipColor, isCheckOn, pieceAt, type Square } from "./positionDraft";

/**
 * 組んだ局面のうち、将棋の規則に反しているところを挙げる
 *
 * **止めるためのものではない。** 研究のために規則から外れた局面を組むことはあるし、
 * 詰将棋は玉が1枚しか無い。挙げたものは断りとして見せるだけで、作成は押せるまま。
 *
 * **玉の枚数は挙げない。** 詰将棋には攻め方の玉が無く、片側3枚も研究のために
 * 並べることがある。
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

export interface PositionIssue {
  kind: PositionIssueKind;
  /** 断りの箇条書きに出す1行。それだけ読んで意味が通ること */
  message: string;
  /** 枠を付ける升。1つの断りが複数の升にかかることがある（二歩） */
  squares: Square[];
}

export interface PositionInspection {
  issues: PositionIssue[];
  /** `squareKey` の集合。升ごとに「枠を付けるか」を引くために持つ */
  illegalSquares: ReadonlySet<string>;
}

/**
 * 升を `Set` の鍵にする綴り
 *
 * `illegalSquares` の要素はこの綴りで入る。引き当てる側も同じ関数を通すこと ——
 * 座標から鍵を組む式が2箇所にあると、片方だけ書式が変わっても
 * 「枠が付かない」という形でしか出ない。
 */
export function squareKey(sq: Square): string {
  return `${sq.x},${sq.y}`;
}

/**
 * その駒が動けなくなる段の深さ
 *
 * `shogi.js` の `getIllegalUnpromotedRow` と同じ式。向こうは private なので写している。
 * 0 は「どの段でも動ける」。
 */
function illegalUnpromotedRow(kind: Kind): number {
  switch (kind) {
    case "FU":
    case "KY":
      return 1;
    case "KE":
      return 2;
    default:
      return 0;
  }
}

/** その駒から見て、相手陣の端から数えた段数。先手は上（y が小さい方）が相手陣 */
function rowToOppositeEnd(y: number, color: Color): number {
  return color === 0 ? y : BOARD_SIZE.HEIGHT + 1 - y;
}

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
        message: `${x}筋に${colorToString(color)}の歩が${squares.length}枚あります（二歩）`,
        squares,
      });
    }
  }
  return issues;
}

function findDeadEnds(state: JKFState): PositionIssue[] {
  const issues: PositionIssue[] = [];
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      const piece = pieceAt(state, { x, y });
      if (!piece) continue;
      // `shogi.js` の `move` が強制的に成らせる条件と同じ向き。
      // 深さ0（どの段でも動ける駒）は段が必ず1以上なので、ここで落ちる
      if (illegalUnpromotedRow(piece.kind) < rowToOppositeEnd(y, piece.color)) continue;
      const square = { x, y };
      issues.push({
        kind: POSITION_ISSUE.DEAD_END,
        message: `${describe(square)}の${colorToString(piece.color)}の${toKan(piece.kind)}は、そこから動けません`,
        squares: [square],
      });
    }
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
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      if (pieceAt(state, { x, y })) return [];
    }
  }
  return [
    {
      kind: POSITION_ISSUE.EMPTY_BOARD,
      // 枠を付ける升は無い。盤が丸ごと空なので、示すべき升が選べない
      message: "盤に駒が1枚もありません",
      squares: [],
    },
  ];
}

function countKings(state: JKFState, color: Color): number {
  let n = 0;
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      const piece = pieceAt(state, { x, y });
      if (piece?.kind === "OU" && piece.color === color) n++;
    }
  }
  return n;
}

function findKing(state: JKFState, color: Color): Square | null {
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      const piece = pieceAt(state, { x, y });
      if (piece?.kind === "OU" && piece.color === color) return { x, y };
    }
  }
  return null;
}

/**
 * 王手放置
 *
 * **両方に玉が1枚ずつあるときだけ挙げる。** 詰将棋には攻め方の玉が無く、
 * そこに「王手がかかったまま」を出すと、正しい局面に断りが出続ける。
 */
function findCheckIgnored(state: JKFState): PositionIssue[] {
  if (countKings(state, 0) !== 1 || countKings(state, 1) !== 1) return [];

  const passive = flipColor(state.color);
  const king = findKing(state, passive);
  if (!king) return [];
  if (!isCheckOn(state, passive)) return [];

  return [
    {
      kind: POSITION_ISSUE.CHECK_IGNORED,
      message: `${colorToString(passive)}の玉に王手がかかったまま、${colorToString(state.color)}から指す形になっています`,
      squares: [king],
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
