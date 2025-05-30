import { Color, type Kind, Piece } from "shogi.js";

export type BoardPosition = {
  x: number;
  y: number;
};

export type HandPiece = {
  color: Color;
  kind: Kind;
  count: number;
};

export type BoardState = {
  board: Piece[][];
  hands: Piece[][];
  turn: Color;
};
