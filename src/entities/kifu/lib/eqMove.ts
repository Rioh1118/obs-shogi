import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 同じ局面で同じ手を指しているか。分岐の合流の判定に使う
 *
 * 正規化が埋める欄（`relative` など）の有無に左右されないよう、手を決める欄だけを比べる。
 *
 * - to(x,y) は一致必須
 * - 両方が指し手(fromあり)ならfrom(x,y)とpromote一致
 * - それ以外はpieceを一致
 */
export function eqMoveMinimal(a?: Partial<IMoveMoveFormat>, b?: Partial<IMoveMoveFormat>): boolean {
  if (!a || !b) return false;
  if (!a.to || !b.to) return false;

  // to は常に一致条件
  if (a.to.x !== b.to.x || a.to.y !== b.to.y) return false;

  const aIsMove = !!a.from;
  const bIsMove = !!b.from;

  if (aIsMove !== bIsMove) return false;

  if (aIsMove) {
    if (!a.from || !b.from) return false;
    if (a.from.x !== b.from.x || a.from.y !== b.from.y) return false;

    const ap = a.promote === true;
    const bp = b.promote === true;
    return ap === bp;
  }

  return a.piece === b.piece;
}

/**
 * 分岐の合流を判定するときの比較。`applyMoveWithBranch` が使う
 */
export const eqMove = eqMoveMinimal;
