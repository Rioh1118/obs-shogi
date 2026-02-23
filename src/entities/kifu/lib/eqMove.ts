import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * Minimalな一致
 *
 * - to(x,y) は一致必須
 * - 両方が指し手(fromあり)ならfrom(x,y)とpromoteおw一致
 * - それ以外はpieceを一致
 */
export function eqMoveMinimal(
  a?: Partial<IMoveMoveFormat>,
  b?: Partial<IMoveMoveFormat>,
): boolean {
  if (!a || !b) return false;
  if (!a.to || !b.to) return false;

  // to は常に一致条件
  if (a.to.x !== b.to.x || a.to.y !== b.to.y) return false;

  const isMove = !!a.from || !!b.from;

  // 両方 from がある（指し手）
  if (isMove) {
    if (a.from && b.from) {
      if (a.from.x !== b.from.x || a.from.y !== b.from.y) return false;
    }
    const ap = a.promote === true;
    const bp = b.promote === true;
    return ap === bp;
  }
  // 打ち（または片方がfrom無し）: piece で一致
  return a.piece === b.piece;
}

/**
 * 厳密一致
 */
export function eqMoveFull(a?: IMoveMoveFormat, b?: IMoveMoveFormat): boolean {
  if (!a || !b) return false;

  const sameSquare = (
    p?: { x: number; y: number },
    q?: { x: number; y: number },
  ) => (!p && !q) || (p && q && p.x === q.x && p.y === q.y);

  if (a.color !== b.color) return false;
  if (a.piece !== b.piece) return false;
  if (!sameSquare(a.from, b.from)) return false;
  if (!sameSquare(a.to, b.to)) return false;

  if (!!a.promote !== !!b.promote) return false;
  if (a.capture !== b.capture) return false;
  if (a.same !== b.same) return false;
  if (a.relative !== b.relative) return false;

  return true;
}

/**
 * （applyMoveWithBranchが合流判定に使うのは Minimal が安全）
 */
export const eqMove = eqMoveMinimal;
