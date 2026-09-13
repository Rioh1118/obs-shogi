import type { Color } from "shogi.js";
import type { HandKind, Square } from "@/entities/position/lib/positionDraft";

/**
 * 掴んでいるもの
 *
 * **どこから掴んだかを持つ。** 駒の種類だけだと、盤から掴んだ駒を離したときに
 * 元の升へ戻せない（盤の駒は掴んだ時点では盤に残したままにしてある）。
 *
 * **フックと別のファイルに置く。** 押す前に見せる側（`lib/boardMarks.ts`）は
 * 純関数で、React を1つも要らない。フックの中に型を置くと、その純関数が
 * `useState` を持つファイルを読むことになる。
 */
export type Held = { from: "square"; sq: Square } | { from: "hand"; kind: HandKind; color: Color };
