import type { Color, Kind, Shogi } from "shogi.js";
import type { JKFPlayer } from "json-kifu-format";
import type { StandardMoveFormat } from "../model/types";
import { canPromote } from "./moveValidation";

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

  const to = { x: Number(move[3]), y: rankOf(move[4]) };
  const promoted = move[5] === "+";

  return {
    from,
    to,
    piece: moved.kind,
    color,
    // **成れない手に `promote` を載せない。**
    //
    // JKF は欄の有無で「不成」を出し分ける（`toIMoveMoveFormat`）ので、
    // `false` を常に載せると成れない手まで「２六歩不成」になる。
    // 逆に落とし切ると、成れたのに成らなかった手から「不成」が消えて
    // **同じ綴りが2つの手を指す**ようになる。載せるのは成れたときだけ
    ...(promoted || canPromote(shogi, { from, to }) ? { promote: promoted } : {}),
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

/**
 * 盤がいま辿っている線を、根からの USI の綴りで表す。**綴れない手が1つでもあれば `null`。**
 *
 * **`tesuu` では線を見分けられない。** `goto` は届かなければ黙って止まり、
 * 実在しない変化は黙って捨てて同じ `tesuu` の別の線に着く。
 * 4手目から分岐を1本作った盤も、本譜を4手進めた盤も、`tesuu` は等しく 4 になる。
 *
 * 対局と突き合わせるときに要るのは**同じ手順を辿っているか**であって、
 * 同じ深さに居るかではない —— 深さだけで見ると、分岐で指した手が
 * 対局の次の1手として Rust へ出る（`useGameMoveGate`）し、
 * 分岐の枝に対局の手が生える（`GameMoveBridge`）。
 *
 * 綴れない手は `null` にして**分からないことを「一致」と読ませない。**
 * 特殊手（投了・中断）は綴りを持たないので、入った時点でここから先は比べられない。
 */
export function lineUsiMoves(player: JKFPlayer): string[] | null {
  const moves: string[] = [];

  for (let te = 1; te <= player.tesuu; te++) {
    const move = player.getMove(te);
    if (move === undefined) return null;

    const usiMove = toUsiMove(move as StandardMoveFormat);
    if (usiMove === null) return null;
    moves.push(usiMove);
  }

  return moves;
}

/** `a` が `b` の先頭と一致するか。**同じ長さも「先頭」に含む** */
export function isPrefixOf(a: readonly string[], b: readonly string[]): boolean {
  return a.length <= b.length && a.every((move, i) => move === b[i]);
}
