import type { Color } from "shogi.js";

export interface PieceProps {
  color: Color;
  onClick?: () => void;
}

export { default as Pawn } from "./Pawn";
export { default as Lance } from "./Lance";
export { default as Knight } from "./Knight";
export { default as Silver } from "./Silver";
export { default as Gold } from "./Gold";
export { default as Bishop } from "./Bishop";
export { default as Rook } from "./Rook";
export { default as King } from "./King";
export { default as PromPawn } from "./PromPawn";
export { default as PromLance } from "./PromLance";
export { default as PromKnight } from "./PromKnight";
export { default as PromSilver } from "./PromSilver";
export { default as Horse } from "./Horse";
export { default as Dragon } from "./Dragon";
