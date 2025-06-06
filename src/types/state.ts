import { Color, type Kind } from "shogi.js";
export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export type GameMode = "replay" | "analysis";
