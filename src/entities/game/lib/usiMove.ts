import type { Color, Kind, Shogi } from "shogi.js";
import type { StandardMoveFormat } from "../model/types";

/**
 * 盤で決まった手を USI の綴りにする。
 *
 * **対局の境界へ出る唯一の綴り。** `submit_game_move` に渡した綴りは、そのまま
 * Rust の写しに載り、`continue_game` で突き合わせられ、`position` の1行として
 * エンジンへ飛ぶ。ここが1文字ずれると、**盤とエンジンが別の局面を進む。**
 *
 * **筋はそのままの数字、段は `a`〜`i`。** JKF は段を 1〜9 の数字で持つので、
 * 写し違えても型では落ちない（`7g7f` が `7g76` になっても `string`）。
 * 綴りが通ることは `judgeGameOutcome` の `USI_MOVE` が別に見ている。
 */
export function toUsiMove(move: StandardMoveFormat): string | null {
  const to = square(move.to.x, move.to.y);
  if (to === null) return null;

  if (move.from === undefined) {
    const dropped = DROP_LETTER[move.piece as Kind];
    // **玉は打てない。** 打てない駒の綴りを作ると、Rust は形として通したうえで
    // エンジンが解釈できない行を受け取る
    return dropped === undefined ? null : `${dropped}*${to}`;
  }

  const from = square(move.from.x, move.from.y);
  if (from === null) return null;

  // **成りは末尾の `+` だけで表す。** 成った後の駒種を書かない
  return `${from}${to}${move.promote === true ? "+" : ""}`;
}

/** 盤の升。**9×9の外は綴れない** */
function square(x: number, y: number): string | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 1 || x > 9 || y < 1 || y > 9) return null;
  return `${x}${RANK[y - 1]}`;
}

/** 段。**上から `a`。** JKF の `y` は1始まり */
const RANK = ["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;

/**
 * 打てる駒の綴り。**玉を入れない**（打てないので、入れると綴れてしまう）。
 *
 * **成駒も入れない。** 打つのは必ず生駒で、`TO` や `NY` を打つ手は存在しない。
 */
const DROP_LETTER: Partial<Record<Kind, string>> = {
  FU: "P",
  KY: "L",
  KE: "N",
  GI: "S",
  KI: "G",
  KA: "B",
  HI: "R",
};

/**
 * USI の綴りを、盤へ積める手に戻す。**盤の現局面が要る。**
 *
 * USI は「どの駒が動いたか」を綴りに持たないので、`shogi` の升を引いて駒種を決める。
 * 局面が違えば別の駒種になるので、**その手を指す直前の局面**を渡すこと。
 *
 * 使い道は1つ —— **こちらが出していない手**（エンジンが決めた手）を盤へ載せること。
 * 人の手は盤から出ているので、戻す必要が無い。
 */
export function fromUsiMove(
  usiMove: string,
  shogi: Shogi,
  color: Color,
): StandardMoveFormat | null {
  const drop = /^([PLNSGBR])\*([1-9])([a-i])$/.exec(usiMove);
  if (drop !== null) {
    const piece = DROP_KIND[drop[1]];
    if (piece === undefined) return null;
    return { to: { x: Number(drop[2]), y: rankOf(drop[3]) }, piece, color };
  }

  const move = /^([1-9])([a-i])([1-9])([a-i])(\+?)$/.exec(usiMove);
  if (move === null) return null;

  const from = { x: Number(move[1]), y: rankOf(move[2]) };
  const moved = shogi.get(from.x, from.y);
  // 盤に駒が無い升からは指せない。**局面がずれている合図**なので黙って積まない
  if (!moved || moved.color !== color) return null;

  return {
    from,
    to: { x: Number(move[3]), y: rankOf(move[4]) },
    piece: moved.kind,
    color,
    promote: move[5] === "+",
  };
}

/** 段の文字から `y`。**`toUsiMove` の `RANK` と対で、片方だけ直すと綴りが崩れる** */
function rankOf(rank: string): number {
  return RANK.indexOf(rank as (typeof RANK)[number]) + 1;
}

/** 打てる駒の綴りから駒種。**`DROP_LETTER` の逆** */
const DROP_KIND: Record<string, Kind> = {
  P: "FU",
  L: "KY",
  N: "KE",
  S: "GI",
  G: "KI",
  B: "KA",
  R: "HI",
};
