import { Color, Record } from "tsshogi";
// 変換後の指し手データ型
export interface ConvertedMove {
  move: string; // 日本語表記（例: "７六歩"）
  isBlack: boolean; // 先手かどうか
}

// SFEN手順配列を日本語データ配列に変換
export function convertSfenSequence(
  sfen: string | null,
  sfenMoves: string[],
): ConvertedMove[] {
  if (!sfen) {
    return [];
  }
  const usiString = `position sfen ${sfen} moves ${sfenMoves.join(" ")}`;

  const record = Record.newByUSI(usiString);
  if (record instanceof Error) {
    console.warn("[SFEN_CONVERTER] No moves in record");
    return [];
  }

  return record.moves.slice(1).map((move) => ({
    move: move.displayText,
    isBlack: move.prev!.nextColor === Color.BLACK,
  }));
}

// 評価値フォーマット
export function formatEvaluation(evaluation: number | null): string {
  if (evaluation === null) return "---";
  return evaluation > 0 ? `+${evaluation}` : `${evaluation}`;
}

// 評価値をパーセンテージに変換（評価バー用）
// -3000〜+3000を0〜100%にマッピング、範囲外はクランプ
export function evaluationToPercentage(evaluation: number | null): number {
  if (evaluation === null) return 50;

  // -3000以下なら0%、+3000以上なら100%
  if (evaluation <= -3000) return 0;
  if (evaluation >= 3000) return 100;

  // -3000〜+3000を0〜100%にリニアマッピング
  return ((evaluation + 3000) / 6000) * 100;
}
