import type { Color } from "shogi.js";
import type { HandKind, Square } from "@/entities/position/lib/positionDraft";

/**
 * 掴んでいるものと、それをどこから掴んだか
 *
 * 盤の駒は掴んでも盤に残してあるので、置くときに動かす駒を升で指す。
 * 駒台の駒は、種類とどちらの駒台かで指す。
 *
 * フックと別のファイルに置く。押す前に見せる側（`lib/boardMarks.ts`）は
 * React を要らない純関数で、フックの中に型を置くと、その純関数が
 * `useState` を持つファイルを読むことになる。
 */
export type Held = { from: "square"; sq: Square } | { from: "hand"; kind: HandKind; color: Color };
