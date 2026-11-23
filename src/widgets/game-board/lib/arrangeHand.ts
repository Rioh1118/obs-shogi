import type { Kind, Piece } from "shogi.js";

/** 駒台に置く1つ。`count` が 2 以上なら、1枚の絵に枚数を添える */
export type HandItem = { kind: Kind; count: number };

/** 駒台の4段。上から強い順で、後手は呼び手が上下を逆にする */
export type HandRows = [HandItem[], HandItem[], HandItem[], HandItem[]];

/** 強い順。駒台へ置く順でもある */
const ORDER: readonly Kind[] = ["HI", "KA", "KI", "GI", "KY", "KE", "FU"];

/** 1枚ずつ並べる上限。これを超えたら、種類ごとに1枚と枚数にする */
const MAX_SINGLES = 12;

/** 1段に収まる枚数。ここまでは、いちばん強い駒の格の段に置く */
const ONE_ROW = 3;

/** 種類ごとに置くときの、1段の数 */
const KINDS_PER_ROW = 2;

/** いちばん強い駒の格の段（飛角、金銀、香桂、歩） */
function rankRow(kinds: readonly Kind[]): number {
  const has = (...ranks: Kind[]) => kinds.some((kind) => ranks.includes(kind));

  if (has("HI", "KA")) return 0;
  if (has("KI", "GI")) return 1;
  if (has("KY", "KE")) return 2;
  return 3;
}

/**
 * 持ち駒を強い順に4段へ割り振る。
 *
 * 12枚までは1枚ずつ置く（実物の駒台と同じ）。それより多いと、駒を小さくする代わりに
 * 種類ごとに1枚と枚数にする。どちらでも駒を縮めて詰め込まない。駒の箱は盤のマスと同じ高さで、
 * 幅を少し詰める（`Hand.scss`）ので、幅の広い駒は盤の駒の9割ほどに描かれる。
 */
export function arrangeHand(pieces: readonly Piece[]): { rows: HandRows; isGrouped: boolean } {
  const counts = new Map<Kind, number>();
  for (const { kind } of pieces) counts.set(kind, (counts.get(kind) ?? 0) + 1);

  const kinds = ORDER.filter((kind) => counts.has(kind));
  const isGrouped = pieces.length > MAX_SINGLES;
  const items: HandItem[] = kinds.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return isGrouped
      ? [{ kind, count }]
      : Array.from({ length: count }, () => ({ kind, count: 1 }));
  });

  const rows: HandRows = [[], [], [], []];
  if (!isGrouped && items.length <= ONE_ROW) {
    rows[rankRow(kinds)] = items;
    return { rows, isGrouped };
  }

  const perRow = isGrouped ? KINDS_PER_ROW : Math.max(KINDS_PER_ROW, Math.ceil(items.length / 4));
  items.forEach((item, i) => rows[Math.floor(i / perRow)].push(item));
  return { rows, isGrouped };
}
