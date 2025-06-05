import type { Kind, JKFMove, ShogiMove, JKFMoveMove } from "@/types";
import type { GameState } from "@/types/state";
import type {
  IMoveFormat,
  IMoveMoveFormat,
  ITimeFormat,
} from "json-kifu-format/dist/src/Formats";

export interface MoveConvertOptions {
  promote?: boolean; // 成りフラグ
  capture?: Kind; // 取った駒（Kind型）
  same?: boolean; // 同○○フラグ
  relative?: string; // 相対的な表記
  comments?: string[]; // コメント
  time?: {
    // 時間情報
    now: ITimeFormat;
    total: ITimeFormat;
  };
  special?: string; // 特殊情報
}

// === ShogiMove → JKFMove 変換 ===
export function convertShogiMoveToJKF(
  move: ShogiMove,
  options?: MoveConvertOptions,
): JKFMove {
  const jkfMove: JKFMove = {};

  // 1. 基本的な指し手情報を変換
  if (move.to && move.kind && move.color !== undefined) {
    const moveDetail: JKFMoveMove = {
      color: move.color, // 必須
      piece: move.kind, // 必須
      to: { x: move.to.x, y: move.to.y },
    };

    // fromがある場合（通常の手）
    if (move.from) {
      moveDetail.from = { x: move.from.x, y: move.from.y };
    }

    // optionsからの追加情報
    if (options?.promote) {
      moveDetail.promote = true;
    }

    if (options?.capture) {
      moveDetail.capture = options.capture;
    }

    if (options?.same) {
      moveDetail.same = true;
    }

    if (options?.relative) {
      moveDetail.relative = options.relative;
    }

    jkfMove.move = moveDetail;
  }

  // 2. JKFMoveレベルの追加情報
  if (options?.comments && options.comments.length > 0) {
    jkfMove.comments = options.comments;
  }

  if (options?.time) {
    jkfMove.time = options.time;
  }

  if (options?.special) {
    jkfMove.special = options.special;
  }

  return jkfMove;
}

/**
 * GameStateとShogiMoveからMoveConvertOptionsを作成
 */
export function createMoveConvertOptions(
  state: GameState,
  move: ShogiMove,
  options?: {
    promote?: boolean;
    comments?: string[];
    special?: string;
  },
): MoveConvertOptions {
  if (!state.shogiGame) {
    return options || {};
  }

  const convertOptions: MoveConvertOptions = {};

  // 1. 成りフラグ（引数で指定された場合はそれを使用）
  if (options?.promote !== undefined) {
    convertOptions.promote = options.promote;
  }

  // 2. 取った駒を判定
  if (move.to) {
    const capturedPiece = state.shogiGame.get(move.to.x, move.to.y);
    if (capturedPiece) {
      convertOptions.capture = capturedPiece.kind;
    }
  }

  // 3. same（同○○）フラグの判定
  // 直前の相手の手で動かした駒を取る場合にtrueになる
  if (state.lastMove && move.to && convertOptions.capture) {
    // lastMoveのtoの位置と現在のmoveのtoが同じで、かつ駒を取る場合
    convertOptions.same =
      state.lastMove.to?.x === move.to.x && state.lastMove.to?.y === move.to.y;
  }

  // 4. コメント（引数で指定された場合）
  if (options?.comments && options.comments.length > 0) {
    convertOptions.comments = options.comments;
  }

  // 5. 特殊情報（引数で指定された場合）
  if (options?.special) {
    convertOptions.special = options.special;
  }

  // relative と time は無視

  return convertOptions;
}
