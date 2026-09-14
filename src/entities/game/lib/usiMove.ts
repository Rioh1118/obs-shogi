import type { Kind } from "shogi.js";
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
