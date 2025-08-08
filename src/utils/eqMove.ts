// src/services/branch/eqMove.ts
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * from/to(座標) / piece / color / promote / capture / same / relative を比較
 * 省略されがちなフィールドも「undefined 同士なら同じ」と判定
 */
export function eqMove(a?: IMoveMoveFormat, b?: IMoveMoveFormat): boolean {
  if (!a || !b) return false;
  if (a.color !== b.color) return false;
  if (a.piece !== b.piece) return false;

  const sameSquare = (
    p?: { x: number; y: number },
    q?: { x: number; y: number },
  ) => (!p && !q) || (p && q && p.x === q.x && p.y === q.y);

  if (!sameSquare(a.from, b.from)) return false;
  if (!sameSquare(a.to, b.to)) return false;

  // optional flags
  if (!!a.promote !== !!b.promote) return false;
  if (a.capture !== b.capture) return false; // Kind or undefined
  if (a.same !== b.same) return false;
  if (a.relative !== b.relative) return false;

  return true;
}
