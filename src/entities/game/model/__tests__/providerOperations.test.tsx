// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Color } from "shogi.js";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GameContextType, GamePersistence, MoveGate } from "../types";
import { branchIndexFromForkIndex, MAIN_LINE } from "@/entities/kifu/model/branch";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Err, Ok } from "@/shared/lib/result";

/**
 * `GameProvider` の操作ごとの振る舞い。
 *
 * 盤の選択、局面の移動、分岐の編集は `useGame` の外から見える契約で、
 * 読み手の部品はこれらの結果をそのまま描く。
 */

/** 2手目に変化が1本ある棋譜。本線は3手、変化は4手で終わる */
const FORKED: JKFData = {
  header: {},
  moves: [
    { comments: ["開始"] },
    { move: { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black } },
    {
      comments: ["本線の2手目"],
      move: { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: Color.White },
      forks: [
        [
          {
            comments: ["変化の2手目"],
            move: { from: { x: 8, y: 3 }, to: { x: 8, y: 4 }, piece: "FU", color: Color.White },
          },
          { move: { from: { x: 2, y: 7 }, to: { x: 2, y: 6 }, piece: "FU", color: Color.Black } },
          { move: { from: { x: 8, y: 4 }, to: { x: 8, y: 5 }, piece: "FU", color: Color.White } },
        ],
      ],
    },
    { move: { from: { x: 2, y: 7 }, to: { x: 2, y: 6 }, piece: "FU", color: Color.Black } },
  ],
};

/** 平手の空の棋譜 */
const HIRATE: JKFData = { header: {}, moves: [{}] };

/**
 * 先手が金を1枚持ち、5七の銀が飛車の筋を止めている局面。
 * 銀は5筋を外れると王手放置になる
 */
const PINNED_SILVER: JKFData = {
  header: {},
  initial: {
    preset: "OTHER",
    data: {
      color: Color.Black,
      board: boardOf([
        { x: 2, y: 1, color: Color.White, kind: "OU" },
        { x: 5, y: 5, color: Color.White, kind: "HI" },
        { x: 5, y: 7, color: Color.Black, kind: "GI" },
        { x: 5, y: 8, color: Color.Black, kind: "OU" },
      ]),
      hands: [{ KI: 1 }, {}],
    },
  },
  moves: [{}],
} as unknown as JKFData;

function boardOf(pieces: { x: number; y: number; color: Color; kind: string }[]) {
  const board: { color?: Color; kind?: string }[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => ({})),
  );
  for (const { x, y, color, kind } of pieces) board[x - 1][y - 1] = { color, kind };
  return board;
}

const SAVED: GamePersistence = { absPath: "/w/a.kif", save: async () => Ok(undefined) };

function mountGame(persistence: GamePersistence | null = SAVED, moveGate?: MoveGate) {
  const seen: { current: GameContextType | null } = { current: null };

  function Probe() {
    seen.current = useGame();
    return null;
  }

  render(
    <GameProvider persistence={persistence ?? undefined} moveGate={moveGate}>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

/** 棋譜を載せる。`loadGame` は投げないので、載らなければここで落とす */
async function mountLoaded(
  jkf: JKFData,
  persistence: GamePersistence | null = SAVED,
  moveGate?: MoveGate,
) {
  const game = mountGame(persistence, moveGate);
  await act(async () => {
    const loaded = await game.current!.loadGame(jkf, "/w/a.kif");
    expect(loaded.success).toBe(true);
  });
  return game;
}

function destinations(game: { current: GameContextType | null }) {
  return game.current!.view.legalMoves.map((move) => move.to);
}

afterEach(cleanup);

describe("view", () => {
  test("何も読み込んでいなければ空を返す", () => {
    const { view } = mountGame().current!;

    expect(view).toEqual({
      player: null,
      lastMove: null,
      currentMove: undefined,
      currentComments: [],
      currentTurn: Color.Black,
      totalMoves: 0,
      currentSfen: null,
      legalMoves: [],
      hasKifu: false,
    });
  });

  test("開始局面の SFEN は手数が 1 で、手の情報を持たない", async () => {
    const { view } = (await mountLoaded(FORKED)).current!;

    expect(view.currentSfen).toBe(
      "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
    );
    expect(view.currentMove).toBeUndefined();
    expect(view.lastMove).toBeNull();
    expect(view.currentComments).toEqual(["開始"]);
    expect(view.totalMoves).toBe(3);
  });

  test("進めた局面の手番、手、コメント、SFEN を映す", async () => {
    const game = await mountLoaded(FORKED);

    act(() => game.current!.goToIndex(2));

    const { view } = game.current!;
    expect(view.currentTurn).toBe(Color.Black);
    expect(view.currentMove?.to).toEqual({ x: 3, y: 4 });
    expect(view.lastMove?.to).toEqual({ x: 3, y: 4 });
    expect(view.currentComments).toEqual(["本線の2手目"]);
    expect(view.currentSfen?.endsWith(" b - 2")).toBe(true);
  });

  test("終端の手数は分岐の進路に沿う", async () => {
    const game = await mountLoaded(FORKED);
    const forkPointers = [{ te: 2, forkIndex: 0 }];

    act(() => game.current!.applyCursor({ tesuu: 2, forkPointers }));
    expect(game.current!.view.totalMoves).toBe(4);

    act(() => game.current!.goToStart());
    expect(game.current!.view.totalMoves).toBe(4);
  });
});

describe("局面の移動", () => {
  test("1手ずつ進めて戻す", async () => {
    const game = await mountLoaded(FORKED);

    act(() => game.current!.nextMove());
    expect(game.current!.getCurrentMoveIndex()).toBe(1);

    act(() => game.current!.previousMove());
    expect(game.current!.getCurrentMoveIndex()).toBe(0);
  });

  test("端では state を作り直さない", async () => {
    const game = await mountLoaded(FORKED);
    const atStart = game.current!.state;

    act(() => game.current!.previousMove());
    act(() => game.current!.goToStart());
    expect(game.current!.state).toBe(atStart);

    act(() => game.current!.goToEnd());
    const atEnd = game.current!.state;
    expect(atEnd.cursor?.tesuu).toBe(3);

    act(() => game.current!.nextMove());
    act(() => game.current!.goToEnd());
    expect(game.current!.state).toBe(atEnd);
  });

  test("選んだ変化の線を進路として辿る", async () => {
    const game = await mountLoaded(FORKED);
    const forkPointers = [{ te: 2, forkIndex: 0 }];

    act(() => game.current!.applyCursor({ tesuu: 1, forkPointers }));
    expect(game.current!.state.cursor?.forkPointers).toEqual([]);
    expect(game.current!.state.branchPlan).toEqual(forkPointers);

    act(() => game.current!.goToEnd());
    expect(game.current!.state.cursor?.tesuu).toBe(4);
    expect(game.current!.state.cursor?.forkPointers).toEqual(forkPointers);
  });

  test("進める余地を手数で答える", async () => {
    const game = await mountLoaded(FORKED);
    expect(game.current!.canGoBackward()).toBe(false);
    expect(game.current!.canGoForward()).toBe(true);

    act(() => game.current!.goToEnd());
    expect(game.current!.canGoBackward()).toBe(true);
    expect(game.current!.canGoForward()).toBe(false);
    expect(game.current!.getTotalMoves()).toBe(3);
  });

  test("移動すると駒の選択を解く", async () => {
    const game = await mountLoaded(FORKED);
    await act(() => game.current!.selectSquare(7, 7));
    expect(game.current!.state.selectedPosition).not.toBeNull();

    act(() => game.current!.nextMove());
    expect(game.current!.state.selectedPosition).toBeNull();
  });
});

describe("盤の升の選択", () => {
  test("手番の駒を選び、行き先を候補に出す", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(7, 7));

    expect(game.current!.state.selectedPosition).toEqual({ type: "square", x: 7, y: 7 });
    expect(destinations(game)).toEqual([{ x: 7, y: 6 }]);
  });

  test("動かすと王手放置になる手は候補に出さない", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    await act(() => game.current!.selectSquare(5, 7));

    expect(destinations(game)).toEqual([{ x: 5, y: 6 }]);
  });

  test("相手の駒と空の升は選べない", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(3, 3));
    expect(game.current!.state.selectedPosition).toBeNull();

    await act(() => game.current!.selectSquare(5, 5));
    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("同じ升をもう一度押すと選択を解く", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(7, 7));
    await act(() => game.current!.selectSquare(7, 7));

    expect(game.current!.state.selectedPosition).toBeNull();
    expect(game.current!.view.legalMoves).toEqual([]);
  });

  test("選んだまま別の手番の駒を押すと持ち替える", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(7, 7));
    await act(() => game.current!.selectSquare(2, 7));

    expect(game.current!.state.selectedPosition).toEqual({ type: "square", x: 2, y: 7 });
  });

  test("選んだまま行けない升を押すと選択を解く", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(7, 7));
    await act(() => game.current!.selectSquare(5, 5));

    expect(game.current!.state.selectedPosition).toBeNull();
    expect(game.current!.state.cursor?.tesuu).toBe(0);
  });

  test("行ける升を押すと指し、棋譜へ積む", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(7, 7));
    await act(() => game.current!.selectSquare(7, 6));

    expect(game.current!.state.cursor?.tesuu).toBe(1);
    expect(game.current!.state.selectedPosition).toBeNull();
    expect(game.current!.view.currentMove).toMatchObject({
      from: { x: 7, y: 7 },
      to: { x: 7, y: 6 },
      piece: "FU",
      color: Color.Black,
    });
  });

  test("成りの指定を手へ渡す", async () => {
    const jkf: JKFData = {
      header: {},
      moves: [
        {},
        { move: { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black } },
        { move: { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: Color.White } },
      ],
    };
    const game = await mountLoaded(jkf);
    act(() => game.current!.goToEnd());

    await act(() => game.current!.selectSquare(8, 8));
    await act(() => game.current!.selectSquare(2, 2, true));

    expect(game.current!.view.currentMove).toMatchObject({ piece: "KA", promote: true });
  });

  test("判定が投げたら理由を error に残す", async () => {
    const game = await mountLoaded(HIRATE);

    await act(() => game.current!.selectSquare(10, 1));

    expect(game.current!.state.error).not.toBeNull();
  });

  test("棋譜が無ければ何もしない", async () => {
    const game = mountGame();

    await act(() => game.current!.selectSquare(7, 7));
    act(() => game.current!.selectHand(Color.Black, "FU"));

    expect(game.current!.state.selectedPosition).toBeNull();
  });
});

describe("駒台の選択", () => {
  test("手番の持ち駒を選び、空いている升を候補に出す", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    act(() => game.current!.selectHand(Color.Black, "KI"));

    expect(game.current!.state.selectedPosition).toEqual({
      type: "hand",
      color: Color.Black,
      kind: "KI",
    });
    expect(destinations(game)).toHaveLength(81 - 4);
    expect(destinations(game)).not.toContainEqual({ x: 5, y: 7 });
  });

  test("手番でない側の駒台は選べない", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    act(() => game.current!.selectHand(Color.White, "KI"));

    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("打てる升が無い駒は選べない", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    act(() => game.current!.selectHand(Color.Black, "HI"));

    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("選んだ持ち駒を空いている升へ打つ", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    act(() => game.current!.selectHand(Color.Black, "KI"));
    await act(() => game.current!.selectSquare(1, 9));

    expect(game.current!.state.cursor?.tesuu).toBe(1);
    const played = game.current!.view.currentMove;
    expect(played).toMatchObject({ to: { x: 1, y: 9 }, piece: "KI", color: Color.Black });
    expect(played?.from).toBeUndefined();
  });

  test("持ち駒を選んだまま打てない升を押すと、手番の駒でも選ばず解く", async () => {
    const game = await mountLoaded(PINNED_SILVER);

    act(() => game.current!.selectHand(Color.Black, "KI"));
    await act(() => game.current!.selectSquare(5, 7));

    expect(game.current!.state.selectedPosition).toBeNull();
    expect(game.current!.state.cursor?.tesuu).toBe(0);
  });

  test("`moveGate` が断った駒打ちは積まず、選択を解く", async () => {
    const refuse: MoveGate = { accept: async () => false };
    const game = await mountLoaded(PINNED_SILVER, SAVED, refuse);

    act(() => game.current!.selectHand(Color.Black, "KI"));
    await act(() => game.current!.selectSquare(1, 9));

    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(game.current!.state.selectedPosition).toBeNull();
  });
});

describe("保存先の無い書き込み", () => {
  test("手は戻り、呼び手へ失敗を返す", async () => {
    const game = await mountLoaded(HIRATE, null);
    const move = {
      from: { x: 7, y: 7 },
      to: { x: 7, y: 6 },
      piece: "FU",
      color: Color.Black,
    } as const;

    await act(async () => {
      expect(await game.current!.makeMove(move)).toEqual(Err("保存先が決まっていません"));
    });

    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(game.current!.state.error).toBe("保存先が決まっていません");
  });
});

describe("分岐の編集", () => {
  const forked = { te: 2, forkPointers: [] };
  const SWAP = { ...forked, a: MAIN_LINE, b: branchIndexFromForkIndex(0) };
  const DELETE = { ...forked, target: branchIndexFromForkIndex(0) };

  test.each([
    ["swapBranches", (game: GameContextType) => game.swapBranches(SWAP)],
    ["deleteBranch", (game: GameContextType) => game.deleteBranch(DELETE)],
  ])("%s は棋譜が無ければ何もせず成功を返す", async (_name, write) => {
    const game = mountGame();

    await act(async () => {
      expect(await write(game.current!)).toEqual(Ok(undefined));
    });

    expect(game.current!.state.blockingWrites).toBe(0);
  });

  test("候補を入れ替えて保存する", async () => {
    const saved: JKFData[] = [];
    const game = await mountLoaded(FORKED, {
      absPath: "/w/a.kif",
      save: async (jkf) => {
        saved.push(jkf);
        return Ok(undefined);
      },
    });

    await act(async () => {
      expect(await game.current!.swapBranches(SWAP)).toEqual(Ok(undefined));
    });

    expect(saved).toHaveLength(1);
    expect(game.current!.state.jkf).toBe(saved[0]);
    expect(saved[0].moves[2].comments).toEqual(["変化の2手目"]);
    expect(game.current!.state.isLoading).toBe(false);
  });

  test("同じ候補どうしの入れ替えは書かない", async () => {
    let saves = 0;
    const game = await mountLoaded(FORKED, {
      absPath: "/w/a.kif",
      save: async () => {
        saves += 1;
        return Ok(undefined);
      },
    });
    const before = game.current!.state.jkf;

    await act(async () => {
      const unchanged = await game.current!.swapBranches({ ...forked, a: MAIN_LINE, b: MAIN_LINE });
      expect(unchanged).toEqual(Ok(undefined));
    });

    expect(saves).toBe(0);
    expect(game.current!.state.jkf).toBe(before);
    expect(game.current!.state.isLoading).toBe(false);
  });

  test("入れ替えの保存に失敗したら、棋譜もカーソルも戻す", async () => {
    const game = await mountLoaded(FORKED, {
      absPath: "/w/a.kif",
      save: async () => Err("書けない"),
    });
    act(() => game.current!.applyCursor({ tesuu: 3, forkPointers: [{ te: 2, forkIndex: 0 }] }));
    const before = game.current!.state;

    await act(async () => {
      expect(await game.current!.swapBranches(SWAP)).toEqual(Err("書けない"));
    });

    expect(game.current!.state.jkf).toBe(before.jkf);
    expect(game.current!.state.cursor).toBe(before.cursor);
    expect(game.current!.state.branchPlan).toBe(before.branchPlan);
    expect(game.current!.state.error).toBe("書けない");
  });

  test("見ている変化を消すと、カーソルは残った線へ移る", async () => {
    const game = await mountLoaded(FORKED);
    act(() => game.current!.applyCursor({ tesuu: 4, forkPointers: [{ te: 2, forkIndex: 0 }] }));

    await act(async () => {
      expect(await game.current!.deleteBranch(DELETE)).toEqual(Ok(undefined));
    });

    expect(game.current!.state.cursor?.forkPointers).toEqual([]);
    expect(game.current!.state.cursor?.tesuu).toBe(2);
    expect(game.current!.state.branchPlan).toEqual([]);
  });

  test.each([
    ["swapBranches", (game: GameContextType) => game.swapBranches({ ...SWAP, b: 9 as never })],
    [
      "deleteBranch",
      (game: GameContextType) => game.deleteBranch({ ...DELETE, target: 9 as never }),
    ],
  ])("%s の指定が棋譜に無ければ、理由を返して書き込みを閉じる", async (_name, write) => {
    const game = await mountLoaded(FORKED);

    await act(async () => {
      const res = await write(game.current!);
      expect(res.success).toBe(false);
    });

    expect(game.current!.state.error).not.toBeNull();
    expect(game.current!.state.blockingWrites).toBe(0);
    expect(game.current!.state.isLoading).toBe(false);
  });
});

describe("コメントの書き込み", () => {
  const ROOT = { tesuu: 0, forkPointers: [] };

  test("局面を動かさなくても本文が変われば書く", async () => {
    const saved: JKFData[] = [];
    const game = await mountLoaded(FORKED, {
      absPath: "/w/a.kif",
      save: async (jkf) => {
        saved.push(jkf);
        return Ok(undefined);
      },
    });

    await act(async () => {
      await game.current!.setCommentsByCursor(ROOT, ["書いた"]);
    });

    expect(saved).toHaveLength(1);
    expect(game.current!.getCommentsByCursor(ROOT)).toEqual(["書いた"]);
  });

  test("本文が同じなら書かない", async () => {
    let saves = 0;
    const game = await mountLoaded(FORKED, {
      absPath: "/w/a.kif",
      save: async () => {
        saves += 1;
        return Ok(undefined);
      },
    });

    await act(async () => {
      expect(await game.current!.setCommentsByCursor(ROOT, ["開始"])).toEqual(Ok(undefined));
    });

    expect(saves).toBe(0);
  });

  test("棋譜に無い手へは書かず、直し方を返す", async () => {
    const game = await mountLoaded(FORKED);

    await act(async () => {
      const res = await game.current!.setCommentsByCursor({ tesuu: 9, forkPointers: [] }, ["x"]);
      expect(res).toEqual(
        Err(
          "この手が棋譜の中に見つかりませんでした。棋譜が変わっている可能性があります。ノートを閉じて開き直してください",
        ),
      );
    });
  });

  test("棋譜が無ければ読みも書きも空で返す", async () => {
    const game = mountGame();

    expect(game.current!.getCommentsByCursor(ROOT)).toEqual([]);
    await act(async () => {
      expect(await game.current!.setCommentsByCursor(ROOT, ["x"])).toEqual(Ok(undefined));
    });
  });
});
