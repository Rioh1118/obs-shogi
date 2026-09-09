/**
 * 数え上げの量のラチェット。**正しさは見ていない**（それは隣の2本の仕事）。
 *
 * 守るのは「判定が入れ子の数え上げに落ちないこと」。落ちると Rust の
 * `RULING_TIMEOUT`（30秒、`src-tauri/src/engine/game/session.rs`）を越え、
 * `over { aborted, winner: null }` で畳まれて**勝敗そのものが消える**。
 *
 * **数えるのは時間ではなく局面の写しの回数。** 王手放置と打ち歩詰めの検査は
 * 候補1手ごとに `Shogi` を1つ作って SFEN で写すので、写した回数がそのまま
 * 数え上げの量になる。壁時計だと台の速度に左右されるうえ、**片側だけの後退を
 * 取り逃がす**（実測: 順序だけ戻しても 13ms のままで、時間では緑になった）。
 *
 * **上限は機械の閾値であって実測値ではない。** ただし余裕は広くない——
 * 数え上げは局面ごとにほぼ一定なので、実測との差が小さくても揺れない。
 * アルゴリズムを変えて越えたら、**測り直して数を書き換えること**。
 */
import { describe, expect, test, vi } from "vitest";
import { Color, Shogi } from "shogi.js";

import { judgeGameOutcome } from "../gameOutcome";
import type { GameRules } from "../gameRules";
import { getAllLegalMoves } from "../moveValidation";

const NO_LIMIT: GameRules = { jishogiRule: "none", maxMoves: 0 };

/**
 * 頭金の詰み形に、双方の持ち歩を足したもの（後手番）。
 *
 * **合法手が1つも無い局面でだけ、駒打ちが最後まで数え上げられる。** そこで
 * 王手放置より先に打ち歩詰めを見る実装だと、歩の1マスごとに相手の応手を
 * 数え上げ、その中の歩打ちでまた同じ検査へ入る（実測 66 秒、写し 1,558,624 回）
 */
const MATED_WITH_PAWNS = "4k4/4G4/4P4/9/9/9/9/9/4K4 w 2P2p 1";

/**
 * 平手から先手の5七歩だけを外し、持ち駒に歩を1枚置いた局面。
 *
 * **5二への歩打ちが王手になる形**（二歩にならないので打ち歩詰めの検査まで進む）。
 * その検査が相手の応手を数え上げるか、1手見つけて打ち切るかで写しの回数が変わる
 */
const PAWN_DROP_CHECKS = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPP1PPPP/1B5R1/LNSGKGSNL b P 1";

/**
 * 玉2枚だけを往復させる。**4手で元の局面に戻るので千日手にも当たる**が、
 * ここが測るのは値段だけなので裁定の中身は問わない（むしろ `perpetualCheck` が
 * 毎回さかのぼる分、`Record` を作り直す形の最悪値に近い）
 */
function longGame(plies: number): string[] {
  const cycle = ["5i4i", "5a4a", "4i5i", "4a5a"];
  return Array.from({ length: plies }, (_, i) => cycle[i % cycle.length]);
}

/**
 * `run` の間に `Shogi` へ局面を写した回数。**上限を超えたら写すのをやめる。**
 *
 * **数え方を本番の側に持たせない。** 試験用のカウンタを `moveValidation.ts` に置くと、
 * それ自体が公開面になって「誰が読むのか」を説明し続けることになる。
 * shogi.js の口を覆えば、`wouldBeInCheckAfterMove` も `isUchifudume` も
 * 同じ1本で数えられる。
 *
 * **超えたときに投げるのは、数えるためではなく止めるため。** 数え上げは同期なので
 * vitest の打ち切りが効かず、そのまま走らせると赤ではなく無言のハングになる。
 * 投げた例外は判定側の `catch` が飲むので伝わらないが、以後の写しがその場で
 * 終わるので即座に戻ってくる。戻った回数が上限を超えていることで赤くなる。
 *
 * `console.log` を黙らせるのは、飲む側（`isUchifudume`）が握り潰しのたびに
 * 例外を書き出すため。どの検査が落ちたのかが埋もれる。
 */
function positionCopiesOf(run: () => void, budget: number): number {
  let copies = 0;
  const original = Shogi.prototype.initializeFromSFENString;
  const spy = vi.spyOn(Shogi.prototype, "initializeFromSFENString").mockImplementation(function (
    this: Shogi,
    sfen: string,
  ) {
    if (++copies > budget) throw new Error(`局面の写しが上限（${budget}）を超えた`);
    original.call(this, sfen);
  });
  const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    run();
  } finally {
    spy.mockRestore();
    quiet.mockRestore();
  }
  return copies;
}

describe("数え上げの量", () => {
  // 実測 75。王手放置より先に打ち歩詰めを見る形へ戻すと 150 になる
  const MATE_BUDGET = 100;

  test(`詰み局面の裁定で、局面の写しが ${MATE_BUDGET} 回を超えない`, () => {
    let outcome;
    const copies = positionCopiesOf(() => {
      outcome = judgeGameOutcome({ startSfen: MATED_WITH_PAWNS, usiMoves: [] }, NO_LIMIT);
    }, MATE_BUDGET);
    expect(copies).toBeLessThanOrEqual(MATE_BUDGET);
    expect(outcome).toEqual({ success: true, data: { kind: "checkmate", winner: "black" } });
  });

  // 実測 48。打ち歩詰めの検査が相手の応手を数え上げる形へ戻すと 69 になる
  const DROP_BUDGET = 55;

  test(`歩打ちが王手になる局面の合法手生成で、局面の写しが ${DROP_BUDGET} 回を超えない`, () => {
    const shogi = new Shogi();
    shogi.initializeFromSFENString(PAWN_DROP_CHECKS);

    let moves: unknown[] = [];
    const copies = positionCopiesOf(() => {
      moves = getAllLegalMoves(shogi, Color.Black);
    }, DROP_BUDGET);
    expect(copies).toBeLessThanOrEqual(DROP_BUDGET);
    expect(moves).toHaveLength(35);
  });

  // こちらは入れ子ではなく、毎回 `Record` を根から組み直す分（手数の2乗）を見る。
  // 写しの回数では捉えられないので壁時計で見る
  test("400手を1手ずつ裁定しても合計 20 秒で返る", () => {
    const moves = longGame(400);
    const started = performance.now();
    for (let ply = 0; ply <= moves.length; ply++) {
      const result = judgeGameOutcome(
        { startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1", usiMoves: moves.slice(0, ply) },
        NO_LIMIT,
      );
      expect(result.success).toBe(true);
    }
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
