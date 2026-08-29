import { JKFPlayer } from "json-kifu-format";
import type {
  IHandFormat,
  IJSONKifuFormat,
  IMoveFormat,
  IPiece,
} from "json-kifu-format/dist/src/Formats";
import { Color, type Kind } from "shogi.js";

export type Placement = { x: number; y: number; color: Color; kind: Kind };

/** 玉だけの最小盤面。任意配置のテストはこれに駒を足して組む。 */
export const KINGS: Placement[] = [
  { x: 5, y: 9, color: Color.Black, kind: "OU" },
  { x: 5, y: 1, color: Color.White, kind: "OU" },
];

const EMPTY_HAND: IHandFormat = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };

/** `IHandFormat` は全駒種が必須なので、書きたい駒だけ渡せるようにする。 */
export function hand(pieces: Partial<IHandFormat> = {}): IHandFormat {
  return { ...EMPTY_HAND, ...pieces };
}

/**
 * 任意配置の JKF を組む
 *
 * 平手から短い手順では作れない局面（同じ駒が3枚同じ地点に利く、持ち駒がある）を
 * 置くために使う。平手で足りるなら {@link newHiratePlayer} を使うこと。
 */
export function buildJkf(
  pieces: Placement[],
  hands: [IHandFormat, IHandFormat],
  moves: IMoveFormat[],
): IJSONKifuFormat {
  const board: IPiece[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, (): IPiece => ({})),
  );
  for (const p of pieces) {
    board[p.x - 1][p.y - 1] = { color: p.color, kind: p.kind };
  }
  return {
    header: {},
    initial: { preset: "OTHER", data: { color: Color.Black, board, hands } },
    moves,
  };
}

/** 平手初期局面の JKFPlayer を作る */
export function newHiratePlayer(): JKFPlayer {
  return new JKFPlayer({ header: {}, initial: { preset: "HIRATE" }, moves: [{}] });
}

/**
 * 4九の金と持ち駒の金がどちらも3九へ行ける局面
 *
 * 「3九金(49)」と「3九金打」を取り違える issue #74 の場面。合流判定と、
 * 表記が「打」で分かれることの両方をここで再現する。
 */
export function newGoldToTheSameSquarePlayer(): JKFPlayer {
  return new JKFPlayer(
    buildJkf(
      [...KINGS, { x: 4, y: 9, color: Color.Black, kind: "KI" }],
      [hand({ KI: 1 }), hand()],
      [{}],
    ),
  );
}
