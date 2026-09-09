/**
 * 終局判定の値段のラチェット。**正しさは見ていない**（それは隣の2本の仕事）。
 *
 * ここが守るのは1つだけ——`judgeGameOutcome` が Rust の `RULING_TIMEOUT`（30秒、
 * `src-tauri/src/engine/game/session.rs`）の中で返ること。返せないと
 * `over { aborted, winner: null }` で畳まれ、**勝敗そのものが消える。**
 *
 * **上限は機械の閾値であって実測値ではない。** 台と負荷で数倍は動くので、
 * 実測に張り付けず、壊れた実装だけが越える桁に置いてある。
 * 越えたときに疑うのは「遅くなった」ではなく「数え上げが入れ子になった」——
 * この2件は、入れ子が復活すると3桁単位で越える。
 *
 * **赤くならず、返ってこないこともある。** 数え上げは同期なので vitest の
 * 打ち切りが効かない（入れ子を戻して実測したところ 200 秒で返らなかった）。
 * この2本のどちらかで `npm run test` が止まったら、それがこの検査の赤である。
 */
import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";

import { judgeGameOutcome } from "../gameOutcome";
import type { GameRules } from "../gameRules";

const NO_LIMIT: GameRules = { jishogiRule: "none", maxMoves: 0 };

/**
 * 頭金の詰み形に、双方の持ち歩だけを足したもの。
 *
 * **歩の枚数が効く。** 打ち歩詰めの検査は相手の応手を数え上げ、その中の歩打ちで
 * また同じ検査へ入る。王手放置で落ちる歩打ちにその値段を先に払う実装だと、
 * 枚数の増加に対して掛け算で伸びる（この形の 2枚 対 2枚 で実測 66 秒）
 */
function matedWithPawnsInHand(hand: string): string {
  return `4k4/4G4/4P4/9/9/9/9/9/4K4 w ${hand} 1`;
}

/**
 * 玉2枚だけを往復させる。**4手で元の局面に戻るので千日手にも当たる**が、
 * ここが測るのは値段だけなので裁定の中身は問わない（むしろ `perpetualCheck` が
 * 毎回さかのぼる分、`Record` を作り直す形の最悪値に近い）
 */
function longGame(plies: number): string[] {
  const cycle = ["5i4i", "5a4a", "4i5i", "4a5a"];
  return Array.from({ length: plies }, (_, i) => cycle[i % cycle.length]);
}

function millisOf(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe("judgeGameOutcome の値段", () => {
  test.each([["2P2p"], ["4P4p"], ["9P9p"]])("持ち歩 %s の詰み局面でも 2 秒で返る", (hand) => {
    const elapsed = millisOf(() => {
      const result = judgeGameOutcome(
        { startSfen: matedWithPawnsInHand(hand), usiMoves: [] },
        NO_LIMIT,
      );
      expect(result).toEqual({
        success: true,
        data: { kind: "checkmate", winner: Color.Black },
      });
    });
    expect(elapsed).toBeLessThan(2000);
  });

  test("400手を1手ずつ裁定しても合計 20 秒で返る", () => {
    const moves = longGame(400);
    const elapsed = millisOf(() => {
      for (let ply = 0; ply <= moves.length; ply++) {
        const result = judgeGameOutcome(
          { startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1", usiMoves: moves.slice(0, ply) },
          NO_LIMIT,
        );
        expect(result.success).toBe(true);
      }
    });
    expect(elapsed).toBeLessThan(20_000);
  });
});
