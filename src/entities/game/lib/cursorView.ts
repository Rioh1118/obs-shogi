import { Color } from "shogi.js";

import { buildPlayer } from "@/entities/kifu/lib/buildPlayer";
import { computeLeafTesuu } from "@/entities/kifu/lib/leafTesuu";
import { plannedCursorFrom, type BranchPlan, type KifuCursor } from "@/entities/kifu/model/cursor";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { GameView } from "../model/types";
import { lastMoveHighlight } from "./moveConverter";

/** `GameView` のうち、棋譜とカーソルだけから決まる欄 */
type CursorView = Omit<GameView, "legalMoves" | "hasKifu">;

const EMPTY_CURSOR_VIEW: CursorView = {
  player: null,
  lastMove: null,
  currentMove: undefined,
  currentComments: [],
  currentTurn: Color.Black,
  totalMoves: 0,
  currentSfen: null,
};

/**
 * 棋譜とカーソルから盤の表示を組む。局面を組み立てられなければ空の表示を返す。
 *
 * 駒の選択は引数に取らない。選択で作り直すと、局面が変わらないのに `JKFPlayer` が
 * 作り直され、`currentSfen` の同一性が変わって下流のエンジン同期や解析が再実行される。
 */
export function buildCursorView(
  jkf: JKFData | null,
  cursor: KifuCursor | null,
  branchPlan: BranchPlan,
): CursorView {
  if (!jkf) return EMPTY_CURSOR_VIEW;

  try {
    const player = buildPlayer(jkf, cursor);

    const plannedCursor = plannedCursorFrom(cursor, branchPlan);

    let totalMoves = 0;
    try {
      totalMoves = computeLeafTesuu(jkf, plannedCursor);
    } catch {
      totalMoves = player.getMaxTesuu();
    }

    const comments = player.getComments();

    // SFEN の手数は 1 始まりなので、初期局面の tesuu 0 は 1 へ丸める。0 のまま渡すと
    // USI 側で不正な position になる。
    // 投げるのは知らない駒種の後手の駒があるとき（`Piece.toSFENString`）で、盤は描ける。
    let currentSfen: string | null = null;
    try {
      currentSfen = player.shogi.toSFENString(player.tesuu || 1);
    } catch {
      currentSfen = null;
    }

    return {
      player,
      lastMove: lastMoveHighlight(player),
      currentMove: player.tesuu === 0 ? undefined : player.getMove(),
      currentComments: Array.isArray(comments) ? comments : [],
      currentTurn: player.shogi.turn,
      totalMoves,
      currentSfen,
    };
  } catch {
    return EMPTY_CURSOR_VIEW;
  }
}
