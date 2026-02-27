import { PIECE_TYPES, PLAYER_COLORS } from "./shogi";

const piecePngs = import.meta.glob("/src/assets/pieces/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function pieceUrl(fileName: string) {
  const key = `/src/assets/pieces/${fileName}`;
  const url = piecePngs[key];
  if (!url) {
    throw new Error(`Piece image not found: ${key}`);
  }
  return url;
}

export const PIECE_IMAGES = {
  [PLAYER_COLORS.SENTE]: {
    [PIECE_TYPES.PAWN]: pieceUrl("black_pawn.png"),
    [PIECE_TYPES.LANCE]: pieceUrl("black_lance.png"),
    [PIECE_TYPES.KNIGHT]: pieceUrl("black_knight.png"),
    [PIECE_TYPES.SILVER]: pieceUrl("black_silver.png"),
    [PIECE_TYPES.GOLD]: pieceUrl("black_gold.png"),
    [PIECE_TYPES.BISHOP]: pieceUrl("black_bishop.png"),
    [PIECE_TYPES.ROOK]: pieceUrl("black_rook.png"),
    [PIECE_TYPES.KING]: pieceUrl("black_king.png"),
    [PIECE_TYPES.PROM_PAWN]: pieceUrl("black_prom_pawn.png"),
    [PIECE_TYPES.PROM_LANCE]: pieceUrl("black_prom_lance.png"),
    [PIECE_TYPES.PROM_KNIGHT]: pieceUrl("black_prom_knight.png"),
    [PIECE_TYPES.PROM_SILVER]: pieceUrl("black_prom_silver.png"),
    [PIECE_TYPES.HORSE]: pieceUrl("black_horse.png"),
    [PIECE_TYPES.DRAGON]: pieceUrl("black_dragon.png"),
  },
  [PLAYER_COLORS.GOTE]: {
    [PIECE_TYPES.PAWN]: pieceUrl("white_pawn.png"),
    [PIECE_TYPES.LANCE]: pieceUrl("white_lance.png"),
    [PIECE_TYPES.KNIGHT]: pieceUrl("white_knight.png"),
    [PIECE_TYPES.SILVER]: pieceUrl("white_silver.png"),
    [PIECE_TYPES.GOLD]: pieceUrl("white_gold.png"),
    [PIECE_TYPES.BISHOP]: pieceUrl("white_bishop.png"),
    [PIECE_TYPES.ROOK]: pieceUrl("white_rook.png"),
    [PIECE_TYPES.KING]: pieceUrl("white_king2.png"),
    [PIECE_TYPES.PROM_PAWN]: pieceUrl("white_prom_pawn.png"),
    [PIECE_TYPES.PROM_LANCE]: pieceUrl("white_prom_lance.png"),
    [PIECE_TYPES.PROM_KNIGHT]: pieceUrl("white_prom_knight.png"),
    [PIECE_TYPES.PROM_SILVER]: pieceUrl("white_prom_silver.png"),
    [PIECE_TYPES.HORSE]: pieceUrl("white_horse.png"),
    [PIECE_TYPES.DRAGON]: pieceUrl("white_dragon.png"),
  },
} as const;
