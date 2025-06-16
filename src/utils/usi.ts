import type { MultiPvCandidate } from "@/commands/engine/types";
import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveMoveFormat,
  IPlaceFormat,
} from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";

// JKFの座標をUSI形式に変換
export function placeToUsi(place: IPlaceFormat): string {
  // USI形式: 1a-9i (xは1-9、yは1-9でa-i)
  const file = place.x.toString();
  const rank = String.fromCharCode(96 + place.y); // 1->a, 2->b, ..., 9->i
  return `${file}${rank}`;
}

// JKFの指し手をUSI形式に変換
export function moveToUsi(move: IMoveMoveFormat): string {
  // 打つ手の場合
  if (!move.from) {
    const piece = move.piece.toUpperCase();
    const to = placeToUsi(move.to!);
    return `${piece}*${to}`;
  }

  // 移動の手の場合
  const from = placeToUsi(move.from);
  const to = placeToUsi(move.to!);
  const promote = move.promote ? "+" : "";
  return `${from}${to}${promote}`;
}

// JKFPlayerの現在状態からUSI position文字列を生成
export function generateUsiPosition(jkfPlayer: JKFPlayer): string {
  if (!jkfPlayer.kifu) {
    return "position startpos";
  }

  const kifu = jkfPlayer.kifu;
  const currentIndex = jkfPlayer.tesuu; // 現在の手数

  // 初期局面の判定
  let initialPosition = "startpos";
  if (kifu.initial) {
    if (kifu.initial.preset === "HIRATE") {
      initialPosition = "startpos";
    } else if (kifu.initial.preset === "OTHER" && kifu.initial.data) {
      // カスタム初期局面の場合はSFEN形式に変換が必要
      // 今回は簡単のためstartposとして扱う
      initialPosition = "startpos";
    } else {
      // その他の手合い（香落ちなど）
      // 実装が複雑なので今回はstartposとして扱う
      initialPosition = "startpos";
    }
  }

  // 指し手を収集（1手目から現在の手数まで）
  const moves: string[] = [];
  for (let i = 1; i <= currentIndex && i < kifu.moves.length; i++) {
    const moveFormat = kifu.moves[i];
    if (moveFormat.move) {
      const usiMove = moveToUsi(moveFormat.move);
      moves.push(usiMove);
    }
  }

  // position文字列を構築
  if (moves.length === 0) {
    return `position ${initialPosition}`;
  } else {
    return `position ${initialPosition} moves ${moves.join(" ")}`;
  }
}

// 現在の手番を取得
export function getCurrentTurnFromJkf(jkfPlayer: JKFPlayer): Color {
  if (!jkfPlayer.kifu) return 0;
  // 手数が奇数なら先手(0)、偶数なら後手(1)
  const moveCount = jkfPlayer.tesuu;
  return ((moveCount % 2) * 1) as Color;
}

// デバッグ用：JKFの情報を表示
export function debugJkfState(jkfPlayer: JKFPlayer) {
  console.log("🎯 JKF Debug Info:", {
    currentIndex: jkfPlayer.tesuu,
    totalMoves: jkfPlayer.kifu?.moves.length,
    currentTurn: getCurrentTurnFromJkf(jkfPlayer),
    position: generateUsiPosition(jkfPlayer),
    currentMove: jkfPlayer.kifu?.moves[jkfPlayer.tesuu]?.move,
  });
}

/**
 * JKFから指し手の配列を抽出（既存のmoveToUsi関数を使用）
 */
export function extractMovesFromJkf(jkfPlayer: JKFPlayer): string[] {
  if (!jkfPlayer.kifu || !jkfPlayer.kifu.moves) {
    return [];
  }

  const moves: string[] = [];
  // 現在の手番まで処理
  const currentTurn = jkfPlayer.tesuu;

  for (let i = 1; i <= currentTurn && i < jkfPlayer.kifu.moves.length; i++) {
    const moveFormat = jkfPlayer.kifu.moves[i];

    if (moveFormat && moveFormat.move) {
      try {
        // 既存のmoveToUsi関数を使用
        const usiMove = moveToUsi(moveFormat.move);
        moves.push(usiMove);
      } catch (error) {
        console.warn(`Failed to convert move ${i}:`, moveFormat.move, error);
        // エラーの場合はその手まででストップ
        break;
      }
    }
  }

  console.log(
    `📝 [USI] Extracted ${moves.length} moves from JKF (turn ${currentTurn}):`,
    moves,
  );
  return moves;
}

/**
 * 指し手配列が有効かチェック
 */
export function validateMoves(moves: string[]): boolean {
  // 基本的なUSI指し手のパターンチェック
  const usiMovePattern = /^([1-9][a-i]){2}\+?$|^[A-Z]\*[1-9][a-i]$/;

  return moves.every((move) => {
    const isValid = usiMovePattern.test(move);
    if (!isValid) {
      console.warn(`Invalid USI move format: ${move}`);
    }
    return isValid;
  });
}

/**
 * 指し手配列を表示用文字列に変換
 */
export function formatMovesForDisplay(moves: string[]): string {
  if (moves.length === 0) {
    return "初期局面";
  }

  return `${moves.length}手目まで: ${moves.slice(-3).join(" ")}${moves.length > 3 ? "..." : ""}`;
}

export function convertToSenteEvaluation(
  engineEvaluation: number,
  currentTurn: Color | null,
): number {
  if (currentTurn === null) {
    console.warn("[ANALISIS] Current turn is null, using raw evaluation");
    return engineEvaluation;
  }

  return currentTurn === Color.Black ? engineEvaluation : -engineEvaluation;
}

export function convertMultiPvToSenteView(
  candidates: MultiPvCandidate[],
  currentTurn: Color | null,
): MultiPvCandidate[] {
  if (currentTurn === null) {
    return candidates;
  }

  return candidates.map((candidate) => ({
    ...candidate,
    evaluation:
      candidate.evaluation !== null && candidate.evaluation !== undefined
        ? convertToSenteEvaluation(candidate.evaluation, currentTurn)
        : null,
  }));
}
