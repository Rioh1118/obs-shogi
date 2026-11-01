// 駒の種類
export const PIECE_TYPES = {
  PAWN: "PAWN",
  LANCE: "LANCE",
  KNIGHT: "KNIGHT",
  SILVER: "SILVER",
  GOLD: "GOLD",
  BISHOP: "BISHOP",
  ROOK: "ROOK",
  KING: "KING",
  PROM_PAWN: "PROM_PAWN",
  PROM_LANCE: "PROM_LANCE",
  PROM_KNIGHT: "PROM_KNIGHT",
  PROM_SILVER: "PROM_SILVER",
  HORSE: "HORSE",
  DRAGON: "DRAGON",
} as const;

// 型定義
type PieceType = (typeof PIECE_TYPES)[keyof typeof PIECE_TYPES];

// JKF形式との対応
export const JKF_TO_PIECE_TYPE = {
  FU: PIECE_TYPES.PAWN,
  KY: PIECE_TYPES.LANCE,
  KE: PIECE_TYPES.KNIGHT,
  GI: PIECE_TYPES.SILVER,
  KI: PIECE_TYPES.GOLD,
  KA: PIECE_TYPES.BISHOP,
  HI: PIECE_TYPES.ROOK,
  OU: PIECE_TYPES.KING,
  TO: PIECE_TYPES.PROM_PAWN,
  NY: PIECE_TYPES.PROM_LANCE,
  NK: PIECE_TYPES.PROM_KNIGHT,
  NG: PIECE_TYPES.PROM_SILVER,
  UM: PIECE_TYPES.HORSE,
  RY: PIECE_TYPES.DRAGON,
} as const;

// 先手/後手
export const PLAYER_COLORS = {
  SENTE: 0 as const,
  GOTE: 1 as const,
} as const;

// 盤面サイズ
export const BOARD_SIZE = {
  WIDTH: 9,
  HEIGHT: 9,
  TOTAL_SQUARES: 81,
} as const;

/** `jkfKind` が JKF の駒でなければ、そのまま返す */
export function convertJkfPiece(jkfKind: string): PieceType | string {
  return JKF_TO_PIECE_TYPE[jkfKind as keyof typeof JKF_TO_PIECE_TYPE] ?? jkfKind;
}
