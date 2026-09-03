import { describe, expect, test } from "vitest";
import type { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { applyMoveWithBranch } from "../applyMoveWithBranch";
import { readableMove } from "../readableMove";
import { newGoldToTheSameSquarePlayer, newHiratePlayer } from "./fixtures";

/**
 * 指定した手を順に inputMove していく (初期手順構築)
 *
 * 手は必ず複製して渡す。applyMoveWithBranch / inputMove は渡された手をそのまま棋譜に
 * 収め、正規化がそれを書き換えるため、共有した定数を渡すと後続のテストが汚れる。
 */
function play(player: JKFPlayer, moves: IMoveMoveFormat[]): void {
  for (const move of moves) {
    const ok = player.inputMove({ ...move });
    if (!ok) {
      throw new Error(`inputMove failed at tesuu=${player.tesuu} for ${JSON.stringify(move)}`);
    }
  }
}

/** 手を複製してから適用する。理由は {@link play} と同じ。 */
function apply(player: JKFPlayer, move: IMoveMoveFormat) {
  return applyMoveWithBranch(player, { ...move });
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

/** 以下2つは同じ地点へ行く指し手と打ち。取り違えると issue #74 が再発する。 */
const KI_49_TO_39: IMoveMoveFormat = {
  from: { x: 4, y: 9 },
  to: { x: 3, y: 9 },
  piece: "KI",
  color: Color.Black,
};

const KI_DROP_39: IMoveMoveFormat = {
  to: { x: 3, y: 9 },
  piece: "KI",
  color: Color.Black,
};

describe("applyMoveWithBranch", () => {
  describe("A. 本線合流", () => {
    test("A1. 次手と完全一致 → forward(), 分岐なし", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);
      player.goto(0);

      const result = apply(player, { ...FU_27_TO_26 });

      expect(result.usedExisting).toBe(true);
      expect(result.createdNew).toBe(false);
      expect(result.tesuu).toBe(1);
      expect(player.kifu.moves[1].forks).toBeUndefined();
    });

    test("A4. promote 違い (不成 既存 / 成り 入力) → 新規 fork", () => {
      const player = newHiratePlayer();
      // 2四歩交換まで進めて 2五歩 / 8五歩 の局面を作る
      play(player, [
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
      const r1 = apply(player, ascend);
      expect(r1.createdNew).toBe(true);

      // 同位置で promote=true → 別 fork
      player.backward();
      const r2 = apply(player, { ...ascend, promote: true });

      expect(r2.createdNew).toBe(true);
      expect(r2.usedExisting).toBe(false);
      expect(player.kifu.moves[5].forks?.length).toBe(1);
    });
  });

  describe("B. 既存変化合流", () => {
    test("B1. forks[0] と一致 → forkAndForward, fork は増えない", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);

      player.goto(0);
      const r1 = apply(player, FU_77_TO_76);
      expect(r1.createdNew).toBe(true);
      expect(player.kifu.moves[1].forks?.length).toBe(1);

      player.goto(0);
      const r2 = apply(player, { ...FU_77_TO_76 });

      expect(r2.usedExisting).toBe(true);
      expect(r2.createdNew).toBe(false);
      expect(player.tesuu).toBe(1);
      expect(player.kifu.moves[1].forks?.length).toBe(1);
    });

    test("B2. 複数 fork のうち 2 番目 forks[1] に合流", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);

      player.goto(0);
      apply(player, FU_77_TO_76);
      player.goto(0);
      apply(player, FU_57_TO_56);
      expect(player.kifu.moves[1].forks?.length).toBe(2);

      player.goto(0);
      const r = apply(player, { ...FU_57_TO_56 });
      expect(r.usedExisting).toBe(true);
      expect(player.kifu.moves[1].forks?.length).toBe(2);
      expect(player.tesuu).toBe(1);
    });
  });

  describe("C. 新規分岐追加 (#74 回帰テスト)", () => {
    test("C1. 末端で新規追加 → 本線末尾に追加 (forks ではない)", () => {
      const player = newHiratePlayer();
      const r = apply(player, FU_27_TO_26);

      expect(r.createdNew).toBe(true);
      expect(player.tesuu).toBe(1);
      expect(player.kifu.moves.length).toBe(2);
      expect(player.kifu.moves[1].forks).toBeUndefined();
    });

    test("C2. 次手存在 / forks 未定義 → forks[0] を作って追加", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);

      player.goto(0);
      const r = apply(player, FU_77_TO_76);

      expect(r.createdNew).toBe(true);
      expect(r.usedExisting).toBe(false);
      expect(player.kifu.moves[1].forks?.length).toBe(1);
      expect(player.tesuu).toBe(1);
    });

    test("C3. 次手存在 / forks 既存 → 末尾に追加", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);

      player.goto(0);
      apply(player, FU_77_TO_76); // fork[0]
      player.goto(0);
      const r = apply(player, FU_57_TO_56); // fork[1]

      expect(r.createdNew).toBe(true);
      expect(player.kifu.moves[1].forks?.length).toBe(2);
      expect(player.kifu.moves[1].forks?.[1][0].move?.from).toEqual({ x: 5, y: 7 });
    });

    test("C4. ★ 既存=指し手 (from 有り) / 入力=打ち (from 無し) → 別 fork", () => {
      const player = newGoldToTheSameSquarePlayer();
      play(player, [KI_49_TO_39]);
      player.goto(0);

      const r = apply(player, KI_DROP_39);

      expect(r.createdNew).toBe(true);
      expect(r.usedExisting).toBe(false);
      expect(player.kifu.moves[1].forks?.length).toBe(1);
      expect(player.kifu.moves[1].move?.from).toEqual({ x: 4, y: 9 }); // 本線は不変
      expect(player.kifu.moves[1].forks?.[0][0].move?.from).toBeUndefined();
    });

    test("C5. ★ 既存=打ち / 入力=指し手 (対称) → 別 fork", () => {
      const player = newGoldToTheSameSquarePlayer();
      play(player, [KI_DROP_39]);
      player.goto(0);

      const r = apply(player, KI_49_TO_39);

      expect(r.createdNew).toBe(true);
      expect(r.usedExisting).toBe(false);
      expect(player.kifu.moves[1].forks?.length).toBe(1);
      expect(player.kifu.moves[1].move?.from).toBeUndefined();
      expect(player.kifu.moves[1].forks?.[0][0].move?.from).toEqual({ x: 4, y: 9 });
    });

    test("C7. 指し手と打ちが分岐一覧で別の文字列になる", () => {
      // 「打」が付くのは applyMoveWithBranch が棋譜全体を再正規化して relative:"H" を
      // 入れるため。この再正規化を外すと、分岐カードに同じ文字列が2枚並ぶ。
      const player = newGoldToTheSameSquarePlayer();
      play(player, [KI_49_TO_39]);
      player.goto(0);
      apply(player, KI_DROP_39);

      const te1 = player.kifu.moves[1];
      expect(readableMove(te1)).toBe("☗３九金");
      expect(readableMove(te1.forks![0][0])).toBe("☗３九金打");
    });

    test("C6. 既存 fork[0] と別 from の指し手は別 fork として追加", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);

      player.goto(0);
      apply(player, FU_77_TO_76);
      player.goto(0);
      apply(player, FU_57_TO_56);

      expect(player.kifu.moves[1].forks?.length).toBe(2);
      expect(player.kifu.moves[1].forks?.[0][0].move?.from).toEqual({ x: 7, y: 7 });
      expect(player.kifu.moves[1].forks?.[1][0].move?.from).toEqual({ x: 5, y: 7 });
    });
  });
});
