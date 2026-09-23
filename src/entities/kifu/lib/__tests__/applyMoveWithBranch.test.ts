import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { applyMoveWithBranch } from "../applyMoveWithBranch";
import { readableMove } from "../readableMove";
import { KINGS, buildJkf, hand, newGoldToTheSameSquarePlayer, newHiratePlayer } from "./fixtures";

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
      // 2四まで歩を伸ばし、2三（敵陣）へ入る手を成と不成で指し分ける
      play(player, [
        FU_27_TO_26,
        FU_83_TO_84,
        FU_26_TO_25,
        { from: { x: 8, y: 4 }, to: { x: 8, y: 5 }, piece: "FU", color: Color.White },
        { from: { x: 2, y: 5 }, to: { x: 2, y: 4 }, piece: "FU", color: Color.Black },
        { from: { x: 8, y: 5 }, to: { x: 8, y: 6 }, piece: "FU", color: Color.White },
      ]);

      // 既存: 2三歩不成
      const ascend: IMoveMoveFormat = {
        from: { x: 2, y: 4 },
        to: { x: 2, y: 3 },
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
      expect(player.kifu.moves[7].forks?.length).toBe(1);
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
      // 「打」が付くのは applyMoveWithBranch が足した手を正規化して relative:"H" を
      // 入れるため。この正規化を外すと、分岐カードに同じ文字列が2枚並ぶ。
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

  describe("D. 棋譜のどこかに盤上で指せない手があっても足せる", () => {
    /**
     * 1手目 2六歩 の変化「7六歩 → 6八玉(59)」の2手目は後手番に先手の玉を動かす。
     * 盤上で指せないので、棋譜全体を正規化すると必ずここで throw する。
     */
    function newPlayerWithBrokenFork(): JKFPlayer {
      return new JKFPlayer({
        header: {},
        initial: { preset: "HIRATE" },
        moves: [
          {},
          {
            move: { ...FU_27_TO_26 },
            forks: [
              [
                { move: { ...FU_77_TO_76 } },
                {
                  move: {
                    from: { x: 5, y: 9 },
                    to: { x: 6, y: 8 },
                    piece: "OU",
                    color: Color.White,
                  },
                },
              ],
            ],
          },
        ],
      });
    }

    test("D1. 別の手順で新規分岐を足せる", () => {
      const player = newPlayerWithBrokenFork();

      const r = apply(player, FU_57_TO_56);

      expect(r.createdNew).toBe(true);
      expect(player.tesuu).toBe(1);
      expect(player.kifu.moves[1].forks?.length).toBe(2);
    });

    test("D2. 線の末尾に足せる", () => {
      const player = newPlayerWithBrokenFork();
      player.forward();

      const r = apply(player, FU_83_TO_84);

      expect(r.createdNew).toBe(true);
      expect(player.tesuu).toBe(2);
      expect(player.kifu.moves[2].move?.to).toEqual({ x: 8, y: 4 });
    });
  });

  describe("E. 足した1手の正規化", () => {
    test("E1. 変化の中の末端で足した手は、その変化の末尾に入る（本譜ではない）", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);
      player.goto(0);
      apply(player, FU_77_TO_76);

      const r = apply(player, FU_83_TO_84);

      expect(r.tesuu).toBe(2);
      expect(r.forkPointers).toEqual([{ te: 1, forkIndex: 0 }]);
      expect(player.kifu.moves.length).toBe(2);
      expect(player.kifu.moves[1].forks?.[0].length).toBe(2);
      expect(player.kifu.moves[1].forks?.[0][1].move?.to).toEqual({ x: 8, y: 4 });
      // 足した手を player が指している
      expect(player.shogi.get(8, 4)?.kind).toBe("FU");
    });

    test("E2. 直前の手と同じ地点へ行く手に same が付き、取った駒が capture に入る", () => {
      const player = newHiratePlayer();
      play(player, [
        FU_77_TO_76,
        { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: Color.White },
        {
          from: { x: 8, y: 8 },
          to: { x: 2, y: 2 },
          piece: "KA",
          color: Color.Black,
          promote: true,
        },
      ]);

      apply(player, { from: { x: 3, y: 1 }, to: { x: 2, y: 2 }, piece: "GI", color: Color.White });

      const added = player.kifu.moves[4].move!;
      expect(added.color).toBe(Color.White);
      expect(added.same).toBe(true);
      expect(added.capture).toBe("UM");
      expect(readableMove(player.kifu.moves[4])).toBe("☖同　銀");
    });

    test("E3. 終局の手の後には足さず、棋譜も変えない", () => {
      const player = new JKFPlayer({
        header: {},
        initial: { preset: "HIRATE" },
        moves: [{}, { move: { ...FU_27_TO_26 } }, { special: "TORYO" }],
      });
      player.goto(2);
      const before = JSON.stringify(player.kifu);

      expect(() => apply(player, FU_83_TO_84)).toThrow();
      expect(JSON.stringify(player.kifu)).toBe(before);
    });

    test("E4. 盤上で指せない手は、棋譜を変える前に投げる", () => {
      const player = newHiratePlayer();
      play(player, [FU_27_TO_26]);
      player.goto(0);
      const before = JSON.stringify(player.kifu);

      // 先手番に後手の歩を動かす
      expect(() => apply(player, FU_83_TO_84)).toThrow();
      expect(JSON.stringify(player.kifu)).toBe(before);
      expect(player.tesuu).toBe(0);
    });

    test.each([
      ["promote 省略", undefined],
      ["promote: false", false],
    ])("E5. 行き所の無い駒を成らずに進める手（%s）は、盤も棋譜も変えずに投げる", (_, promote) => {
      const player = new JKFPlayer(
        buildJkf(
          [...KINGS, { x: 1, y: 2, color: Color.Black, kind: "FU" }],
          [hand(), hand()],
          [{}],
        ),
      );
      const before = JSON.stringify(player.kifu);

      expect(() =>
        apply(player, {
          from: { x: 1, y: 2 },
          to: { x: 1, y: 1 },
          piece: "FU",
          color: Color.Black,
          promote,
        }),
      ).toThrow();
      expect(JSON.stringify(player.kifu)).toBe(before);
      expect(player.shogi.get(1, 2)?.kind).toBe("FU");
      expect(player.shogi.get(1, 1)).toBeNull();
    });

    test.each([
      ["成駒をさらに成らせる", "TO" as const, { x: 2, y: 4 }, { x: 2, y: 3 }],
      ["敵陣の外で成る", "FU" as const, { x: 2, y: 7 }, { x: 2, y: 6 }],
    ])("E6. %s手は、盤も棋譜も変えずに投げる", (_, kind, from, to) => {
      const player = new JKFPlayer(
        buildJkf([...KINGS, { ...from, color: Color.Black, kind }], [hand(), hand()], [{}]),
      );
      const before = JSON.stringify(player.kifu);

      expect(() =>
        apply(player, { from, to, piece: kind, color: Color.Black, promote: true }),
      ).toThrow();
      expect(JSON.stringify(player.kifu)).toBe(before);
      expect(player.shogi.get(from.x, from.y)?.kind).toBe(kind);
    });
  });
});
