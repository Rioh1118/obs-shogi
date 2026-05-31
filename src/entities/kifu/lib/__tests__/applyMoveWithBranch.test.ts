import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { IJSONKifuFormat, IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { applyMoveWithBranch } from "../applyMoveWithBranch";

/** 平手初期局面の JKFPlayer を作る */
function newHiratePlayer(): JKFPlayer {
  const data: IJSONKifuFormat = {
    header: {},
    initial: { preset: "HIRATE" },
    moves: [{}],
  };
  return new JKFPlayer(data);
}

/** 指定した手を順に inputMove していく (初期手順構築) */
function play(jkf: JKFPlayer, moves: IMoveMoveFormat[]): void {
  for (const move of moves) {
    const ok = jkf.inputMove(move);
    if (!ok) {
      throw new Error(`inputMove failed at tesuu=${jkf.tesuu} for ${JSON.stringify(move)}`);
    }
  }
}

const FU_27_TO_26: IMoveMoveFormat = {
  from: { x: 2, y: 7 },
  to: { x: 2, y: 6 },
  piece: "FU",
  color: Color.Black,
};

const FU_83_TO_84: IMoveMoveFormat = {
  from: { x: 8, y: 3 },
  to: { x: 8, y: 4 },
  piece: "FU",
  color: Color.White,
};

const FU_26_TO_25: IMoveMoveFormat = {
  from: { x: 2, y: 6 },
  to: { x: 2, y: 5 },
  piece: "FU",
  color: Color.Black,
};

const FU_77_TO_76: IMoveMoveFormat = {
  from: { x: 7, y: 7 },
  to: { x: 7, y: 6 },
  piece: "FU",
  color: Color.Black,
};

const FU_57_TO_56: IMoveMoveFormat = {
  from: { x: 5, y: 7 },
  to: { x: 5, y: 6 },
  piece: "FU",
  color: Color.Black,
};

describe("applyMoveWithBranch", () => {
  describe("A. 本線合流", () => {
    test("A1. 次手と完全一致 → forward(), 分岐なし", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);
      jkf.goto(0);

      const result = applyMoveWithBranch(jkf, { ...FU_27_TO_26 });

      expect(result.usedExisting).toBe(true);
      expect(result.createdNew).toBe(false);
      expect(result.tesuu).toBe(1);
      expect(jkf.kifu.moves[1].forks).toBeUndefined();
    });

    test("A4. promote 違い (不成 既存 / 成り 入力) → 新規 fork", () => {
      const jkf = newHiratePlayer();
      // 2四歩交換まで進めて 2五歩 / 8五歩 の局面を作る
      play(jkf, [
        FU_27_TO_26,
        FU_83_TO_84,
        FU_26_TO_25,
        {
          from: { x: 8, y: 4 },
          to: { x: 8, y: 5 },
          piece: "FU",
          color: Color.White,
        },
      ]);

      // 既存: 不成で 2五 → 2四 (歩は 3段目以内なら不成可)
      const ascend: IMoveMoveFormat = {
        from: { x: 2, y: 5 },
        to: { x: 2, y: 4 },
        piece: "FU",
        color: Color.Black,
        promote: false,
      };
      const r1 = applyMoveWithBranch(jkf, ascend);
      expect(r1.createdNew).toBe(true);

      // 同位置で promote=true → 別 fork
      jkf.backward();
      const r2 = applyMoveWithBranch(jkf, { ...ascend, promote: true });

      expect(r2.createdNew).toBe(true);
      expect(r2.usedExisting).toBe(false);
      expect(jkf.kifu.moves[5].forks?.length).toBe(1);
    });
  });

  describe("B. 既存変化合流", () => {
    test("B1. forks[0] と一致 → forkAndForward, fork は増えない", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);

      jkf.goto(0);
      const r1 = applyMoveWithBranch(jkf, FU_77_TO_76);
      expect(r1.createdNew).toBe(true);
      expect(jkf.kifu.moves[1].forks?.length).toBe(1);

      jkf.goto(0);
      const r2 = applyMoveWithBranch(jkf, { ...FU_77_TO_76 });

      expect(r2.usedExisting).toBe(true);
      expect(r2.createdNew).toBe(false);
      expect(jkf.tesuu).toBe(1);
      expect(jkf.kifu.moves[1].forks?.length).toBe(1);
    });

    test("B2. 複数 fork のうち 2 番目 forks[1] に合流", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);

      jkf.goto(0);
      applyMoveWithBranch(jkf, FU_77_TO_76);
      jkf.goto(0);
      applyMoveWithBranch(jkf, FU_57_TO_56);
      expect(jkf.kifu.moves[1].forks?.length).toBe(2);

      jkf.goto(0);
      const r = applyMoveWithBranch(jkf, { ...FU_57_TO_56 });
      expect(r.usedExisting).toBe(true);
      expect(jkf.kifu.moves[1].forks?.length).toBe(2);
      expect(jkf.tesuu).toBe(1);
    });
  });

  describe("C. 新規分岐追加 (#74 回帰テスト)", () => {
    test("C1. 末端で新規追加 → 本線末尾に追加 (forks ではない)", () => {
      const jkf = newHiratePlayer();
      const r = applyMoveWithBranch(jkf, FU_27_TO_26);

      expect(r.createdNew).toBe(true);
      expect(jkf.tesuu).toBe(1);
      expect(jkf.kifu.moves.length).toBe(2);
      expect(jkf.kifu.moves[1].forks).toBeUndefined();
    });

    test("C2. 次手存在 / forks 未定義 → forks[0] を作って追加", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);

      jkf.goto(0);
      const r = applyMoveWithBranch(jkf, FU_77_TO_76);

      expect(r.createdNew).toBe(true);
      expect(r.usedExisting).toBe(false);
      expect(jkf.kifu.moves[1].forks?.length).toBe(1);
      expect(jkf.tesuu).toBe(1);
    });

    test("C3. 次手存在 / forks 既存 → 末尾に追加", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);

      jkf.goto(0);
      applyMoveWithBranch(jkf, FU_77_TO_76); // fork[0]
      jkf.goto(0);
      const r = applyMoveWithBranch(jkf, FU_57_TO_56); // fork[1]

      expect(r.createdNew).toBe(true);
      expect(jkf.kifu.moves[1].forks?.length).toBe(2);
      expect(jkf.kifu.moves[1].forks?.[1][0].move?.from).toEqual({ x: 5, y: 7 });
    });

    test("C4. ★ 既存=指し手 (from 有り) / 入力=打ち (from 無し) → 別 fork", () => {
      // 既存 JKF: te=1 に「3九金(49→39)」が入っている状態を手で組む
      // (実盤面の整合は問わず、合流判定のみを検証する)
      const data: IJSONKifuFormat = {
        header: {},
        initial: { preset: "HIRATE" },
        moves: [
          {},
          {
            move: {
              from: { x: 4, y: 9 },
              to: { x: 3, y: 9 },
              piece: "KI",
              color: Color.Black,
            },
          },
        ],
      };
      const player = new JKFPlayer(data);
      player.goto(0);

      const dropMove: IMoveMoveFormat = {
        to: { x: 3, y: 9 },
        piece: "KI",
        color: Color.Black,
      };

      // forkAndForward 内の forward → doMove は局面整合が無いと throw する可能性があるため許容
      try {
        applyMoveWithBranch(player, dropMove);
      } catch {
        // ignore: shogi state mismatch is acceptable for this assertion
      }

      // ★ 期待: 既存指し手と打ちは同一視されず、新規 fork が作られている
      expect(player.kifu.moves[1].forks?.length).toBe(1);
      expect(player.kifu.moves[1].move?.from).toEqual({ x: 4, y: 9 }); // 本線は不変
      expect(player.kifu.moves[1].forks?.[0][0].move?.from).toBeUndefined();
      expect(player.kifu.moves[1].forks?.[0][0].move?.piece).toBe("KI");
    });

    test("C5. ★ 既存=打ち / 入力=指し手 (対称) → 別 fork", () => {
      const data: IJSONKifuFormat = {
        header: {},
        initial: { preset: "HIRATE" },
        moves: [
          {},
          {
            move: {
              to: { x: 3, y: 9 },
              piece: "KI",
              color: Color.Black,
            },
          },
        ],
      };
      const player = new JKFPlayer(data);
      player.goto(0);

      const newMove: IMoveMoveFormat = {
        from: { x: 4, y: 9 },
        to: { x: 3, y: 9 },
        piece: "KI",
        color: Color.Black,
      };

      try {
        applyMoveWithBranch(player, newMove);
      } catch {
        // ignore: shogi state mismatch is acceptable
      }

      expect(player.kifu.moves[1].forks?.length).toBe(1);
      expect(player.kifu.moves[1].move?.from).toBeUndefined();
      expect(player.kifu.moves[1].forks?.[0][0].move?.from).toEqual({ x: 4, y: 9 });
    });

    test("C6. 既存 fork[0] と別 from の指し手は別 fork として追加", () => {
      const jkf = newHiratePlayer();
      play(jkf, [FU_27_TO_26]);

      jkf.goto(0);
      applyMoveWithBranch(jkf, FU_77_TO_76);
      jkf.goto(0);
      applyMoveWithBranch(jkf, FU_57_TO_56);

      expect(jkf.kifu.moves[1].forks?.length).toBe(2);
      expect(jkf.kifu.moves[1].forks?.[0][0].move?.from).toEqual({ x: 7, y: 7 });
      expect(jkf.kifu.moves[1].forks?.[1][0].move?.from).toEqual({ x: 5, y: 7 });
    });
  });
});
