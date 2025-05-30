import { Shogi, Color, type Kind, type IMove } from "shogi.js";
import type { JKFFormat } from "./kifu";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export type GameState = {
  originalJKF: JKFFormat | null;
  currentMoveIndex: number;
  shogiGame: Shogi | null;
  selectedPosition: SelectedPosition | null;
  legalMoves: IMove[];
  lastMove: IMove | null;
  mode: "replay" | "analysis";
  isLoading: boolean;
  error: string | null;
};

export type GameAction =
  | { type: "loading" }
  | { type: "initialize_from_jkf"; payload: JKFFormat }
  | { type: "go_to_move"; payload: { index: number; lastMove: IMove | null } }
  | { type: "select_square"; payload: { x: number; y: number } }
  | { type: "select_hand"; payload: { color: Color; kind: Kind } }
  | { type: "clear_selection" }
  | { type: "set_mode"; payload: "replay" | "analysis" }
  | { type: "error"; payload: string }
  | { type: "update_shogi_game"; payload: Shogi }
  | { type: "apply_move"; payload: { move: IMove; newJkf: JKFFormat } };
