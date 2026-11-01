import { Color, type Kind } from "shogi.js";

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

export const PIECE_IMAGES: Record<Color, Record<Kind, string>> = {
  [Color.Black]: {
    FU: pieceUrl("black_pawn.png"),
    KY: pieceUrl("black_lance.png"),
    KE: pieceUrl("black_knight.png"),
    GI: pieceUrl("black_silver.png"),
    KI: pieceUrl("black_gold.png"),
    KA: pieceUrl("black_bishop.png"),
    HI: pieceUrl("black_rook.png"),
    OU: pieceUrl("black_king.png"),
    TO: pieceUrl("black_prom_pawn.png"),
    NY: pieceUrl("black_prom_lance.png"),
    NK: pieceUrl("black_prom_knight.png"),
    NG: pieceUrl("black_prom_silver.png"),
    UM: pieceUrl("black_horse.png"),
    RY: pieceUrl("black_dragon.png"),
  },
  [Color.White]: {
    FU: pieceUrl("white_pawn.png"),
    KY: pieceUrl("white_lance.png"),
    KE: pieceUrl("white_knight.png"),
    GI: pieceUrl("white_silver.png"),
    KI: pieceUrl("white_gold.png"),
    KA: pieceUrl("white_bishop.png"),
    HI: pieceUrl("white_rook.png"),
    OU: pieceUrl("white_king2.png"),
    TO: pieceUrl("white_prom_pawn.png"),
    NY: pieceUrl("white_prom_lance.png"),
    NK: pieceUrl("white_prom_knight.png"),
    NG: pieceUrl("white_prom_silver.png"),
    UM: pieceUrl("white_horse.png"),
    RY: pieceUrl("white_dragon.png"),
  },
};
