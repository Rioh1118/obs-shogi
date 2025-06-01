import type { IJSONKifuFormat } from "json-kifu-format/dist/src/Formats";

export type KifuFormat = "kif" | "ki2" | "csa" | "jkf" | "unknown";

export interface JKFMoveData {
  from?: { x: number; y: number };
  to: { x: number; y: number };
  piece: string;
  color: number;
  promote?: boolean;
  capture?: string;
  same?: boolean;
  relative?: string;
}

export interface JKFMoveFormat {
  move?: JKFMoveData;
  time?: {
    now?: string;
    total?: string;
  };
  comments?: string[];
  forks?: JKFMoveFormat[][];
  special?: string;
}

export type TypedJKFormat = Omit<IJSONKifuFormat, "moves"> & {
  moves: JKFMoveFormat[];
};

export type { IJSONKifuFormat as JKFFormat } from "json-kifu-format/dist/src/Formats";
//
// 型ガード関数
export function isJKFMoveFormat(move: unknown): move is JKFMoveFormat {
  if (typeof move !== "object" || move === null) return false;

  const m = move as Record<string, unknown>;

  // moveフィールドがある場合の検証
  if (m.move !== undefined) {
    if (typeof m.move !== "object" || m.move === null) return false;
    const moveData = m.move as Record<string, unknown>;

    // 必須フィールドの検証
    if (typeof moveData.to !== "object" || moveData.to === null) return false;
    if (typeof moveData.piece !== "string") return false;
    if (typeof moveData.color !== "number") return false;
  }

  return true;
}

export function isJKFMoveData(data: unknown): data is JKFMoveData {
  if (typeof data !== "object" || data === null) return false;

  const d = data as Record<string, unknown>;

  // 必須フィールドの検証
  if (typeof d.to !== "object" || d.to === null) return false;
  if (typeof d.piece !== "string") return false;
  if (typeof d.color !== "number") return false;

  return true;
}
