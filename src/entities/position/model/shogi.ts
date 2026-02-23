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
export type PieceType = (typeof PIECE_TYPES)[keyof typeof PIECE_TYPES];
export type PlayerColor = 0 | 1;

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
  // 成駒を直接マッピング
  TO: PIECE_TYPES.PROM_PAWN,
  NY: PIECE_TYPES.PROM_LANCE,
  NK: PIECE_TYPES.PROM_KNIGHT,
  NG: PIECE_TYPES.PROM_SILVER,
  UM: PIECE_TYPES.HORSE,
  RY: PIECE_TYPES.DRAGON,
} as const;

// 成り駒の対応（型安全に）
export const PROMOTED_PIECES: Record<string, PieceType> = {
  [PIECE_TYPES.PAWN]: PIECE_TYPES.PROM_PAWN,
  [PIECE_TYPES.LANCE]: PIECE_TYPES.PROM_LANCE,
  [PIECE_TYPES.KNIGHT]: PIECE_TYPES.PROM_KNIGHT,
  [PIECE_TYPES.SILVER]: PIECE_TYPES.PROM_SILVER,
  [PIECE_TYPES.BISHOP]: PIECE_TYPES.HORSE,
  [PIECE_TYPES.ROOK]: PIECE_TYPES.DRAGON,
} as const;

// 先手/後手
export const PLAYER_COLORS = {
  SENTE: 0 as const,
  GOTE: 1 as const,
} as const;

export const PIECE_IMAGES = {
  // 先手（黒）
  [PLAYER_COLORS.SENTE]: {
    [PIECE_TYPES.PAWN]: "/src/assets/pieces/black_pawn.png",
    [PIECE_TYPES.LANCE]: "/src/assets/pieces/black_lance.png",
    [PIECE_TYPES.KNIGHT]: "/src/assets/pieces/black_knight.png",
    [PIECE_TYPES.SILVER]: "/src/assets/pieces/black_silver.png",
    [PIECE_TYPES.GOLD]: "/src/assets/pieces/black_gold.png",
    [PIECE_TYPES.BISHOP]: "/src/assets/pieces/black_bishop.png",
    [PIECE_TYPES.ROOK]: "/src/assets/pieces/black_rook.png",
    [PIECE_TYPES.KING]: "/src/assets/pieces/black_king.png",
    [PIECE_TYPES.PROM_PAWN]: "/src/assets/pieces/black_prom_pawn.png",
    [PIECE_TYPES.PROM_LANCE]: "/src/assets/pieces/black_prom_lance.png",
    [PIECE_TYPES.PROM_KNIGHT]: "/src/assets/pieces/black_prom_knight.png",
    [PIECE_TYPES.PROM_SILVER]: "/src/assets/pieces/black_prom_silver.png",
    [PIECE_TYPES.HORSE]: "/src/assets/pieces/black_horse.png",
    [PIECE_TYPES.DRAGON]: "/src/assets/pieces/black_dragon.png",
  },
  // 後手（白）
  [PLAYER_COLORS.GOTE]: {
    [PIECE_TYPES.PAWN]: "/src/assets/pieces/white_pawn.png",
    [PIECE_TYPES.LANCE]: "/src/assets/pieces/white_lance.png",
    [PIECE_TYPES.KNIGHT]: "/src/assets/pieces/white_knight.png",
    [PIECE_TYPES.SILVER]: "/src/assets/pieces/white_silver.png",
    [PIECE_TYPES.GOLD]: "/src/assets/pieces/white_gold.png",
    [PIECE_TYPES.BISHOP]: "/src/assets/pieces/white_bishop.png",
    [PIECE_TYPES.ROOK]: "/src/assets/pieces/white_rook.png",
    [PIECE_TYPES.KING]: "/src/assets/pieces/white_king2.png", // 玉
    [PIECE_TYPES.PROM_PAWN]: "/src/assets/pieces/white_prom_pawn.png",
    [PIECE_TYPES.PROM_LANCE]: "/src/assets/pieces/white_prom_lance.png",
    [PIECE_TYPES.PROM_KNIGHT]: "/src/assets/pieces/white_prom_knight.png",
    [PIECE_TYPES.PROM_SILVER]: "/src/assets/pieces/white_prom_silver.png",
    [PIECE_TYPES.HORSE]: "/src/assets/pieces/white_horse.png",
    [PIECE_TYPES.DRAGON]: "/src/assets/pieces/white_dragon.png",
  },
} as const;

// 盤面サイズ
export const BOARD_SIZE = {
  WIDTH: 9,
  HEIGHT: 9,
  TOTAL_SQUARES: 81,
} as const;

// 駒の初期配置用の型（型安全に）
export interface Piece {
  color: PlayerColor;
  kind: string;
}

export type PieceData = Piece | null;

// 空のマス
export const EMPTY_SQUARE: PieceData = null;

// 駒を作成するヘルパー
export const createPiece = (color: PlayerColor, kind: string): Piece => ({
  color,
  kind,
});

// JKF形式から内部形式への変換（型安全に）
export function convertJkfPiece(
  jkfKind: string,
  isPromoted: boolean = false,
): PieceType | string {
  // まず直接マッピングを試す（成り駒のkindが直接来る場合）
  const directType =
    JKF_TO_PIECE_TYPE[jkfKind as keyof typeof JKF_TO_PIECE_TYPE];
  if (directType) {
    return directType;
  }

  // 直接マッピングがない場合、isPromotedフラグを使用
  const baseType = JKF_TO_PIECE_TYPE[jkfKind as keyof typeof JKF_TO_PIECE_TYPE];
  if (!baseType) return jkfKind;

  if (isPromoted && baseType in PROMOTED_PIECES) {
    return PROMOTED_PIECES[baseType];
  }

  return baseType;
}

// 型ガード関数
export function isPiece(data: PieceData): data is Piece {
  return (
    data !== null &&
    typeof data === "object" &&
    "color" in data &&
    "kind" in data
  );
}
