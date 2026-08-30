import { describe, expect, it } from "vitest";

import { gameReducer } from "../reducer";
import { initialGameState } from "../types";
import { asBranchPlan } from "@/entities/kifu/model/cursor";

describe("gameReducer", () => {
  // 同じ参照を返さないと state の identity が変わり、それだけで contextValue が
  // 作り直されて useGame() の消費者が全部再レンダする。
  it("selectedPosition が既に null なら clear_selection で同じ state を返す", () => {
    const state = { ...initialGameState, selectedPosition: null };
    expect(gameReducer(state, { type: "clear_selection" })).toBe(state);
  });

  it("error が既に null なら clear_error で同じ state を返す", () => {
    const state = { ...initialGameState, error: null };
    expect(gameReducer(state, { type: "clear_error" })).toBe(state);
  });

  it("値が変わるときは新しい state を返す", () => {
    const selected = {
      ...initialGameState,
      selectedPosition: { type: "square", x: 7, y: 7 } as const,
    };
    const cleared = gameReducer(selected, { type: "clear_selection" });
    expect(cleared).not.toBe(selected);
    expect(cleared.selectedPosition).toBeNull();

    const errored = { ...initialGameState, error: "boom" };
    expect(gameReducer(errored, { type: "clear_error" }).error).toBeNull();
  });
});

// 書き込みは並行しうる。コメントの自動保存は 900ms 後に、開いている面や
// 確認ダイアログとは無関係に撃つ。真偽値で持つと、先に終わった1つが
// **まだ書いている最中に「操作中」を解く**。
describe("走っている書き込みを数える", () => {
  it("先に終わった1つでは isLoading が解けない", () => {
    const one = gameReducer(initialGameState, { type: "write_started" });
    const two = gameReducer(one, { type: "write_started" });
    expect(two.isLoading).toBe(true);

    const oneLeft = gameReducer(two, { type: "write_ended" });
    expect(oneLeft.isLoading).toBe(true);

    expect(gameReducer(oneLeft, { type: "write_ended" }).isLoading).toBe(false);
  });

  // A の保存が失敗して返ってきたときに B が読み込まれていると、
  // B を表す state に A の失敗理由が載る。#277 で描いた瞬間、
  // 別のファイルの失敗が新しく開いたファイルの上に出る。
  it("書こうとした棋譜がもう別物なら、失敗を積まない", () => {
    const placed = { header: {}, moves: [{}] };
    const other = { header: {}, moves: [{}, {}] };

    const onPlaced = gameReducer(
      { ...initialGameState, jkf: placed },
      { type: "write_failed", payload: { error: "boom", expectedJkf: placed } },
    );
    expect(onPlaced.error).toBe("boom");

    const moved = { ...initialGameState, jkf: other };
    expect(
      gameReducer(moved, { type: "write_failed", payload: { error: "boom", expectedJkf: placed } }),
    ).toBe(moved);
  });

  // 失敗したのは撃った1本であって、並行して走っている他の書き込みではない。
  it("set_error は走っている書き込みを終わらせない", () => {
    const writing = gameReducer(initialGameState, { type: "write_started" });
    const errored = gameReducer(writing, { type: "set_error", payload: "boom" });
    expect(errored.error).toBe("boom");
    expect(errored.isLoading).toBe(true);
  });

  // 0 に戻すと、走っている書き込みの write_ended が負へ落として
  // 以後 isLoading が二度と立たなくなる。
  it("棋譜を読み込み直しても、走っている書き込みの本数は持ち越す", () => {
    const writing = gameReducer(initialGameState, { type: "write_started" });
    const loaded = gameReducer(writing, {
      type: "game_loaded",
      payload: {
        jkf: { header: {}, moves: [{}] },
        absPath: "/ws/a.kif",
        cursor: { tesuu: 0, forkPointers: [], tesuuPointer: "0,[]" } as never,
      },
    });
    expect(loaded.isLoading).toBe(true);
    expect(gameReducer(loaded, { type: "write_ended" }).isLoading).toBe(false);
  });
});

describe("jkf_restored", () => {
  const jkfA = { header: {}, moves: [{}] };
  const jkfB = { header: {}, moves: [{}, {}] };
  const cursorA = { tesuu: 0, forkPointers: [], tesuuPointer: "0,[]" } as never;
  const cursorB = { tesuu: 1, forkPointers: [], tesuuPointer: "1,[]" } as never;

  // 書き込みに失敗したときに、置き換える前へ戻す。戻さないとメモリとディスクが
  // 食い違ったまま次の操作が積み上がり、分岐の削除では**別の枝が消える**。
  it("棋譜・カーソル・計画をまとめて戻す", () => {
    const replaced = gameReducer(
      { ...initialGameState, jkf: jkfA, cursor: cursorA, branchPlan: asBranchPlan([]) },
      {
        type: "jkf_replaced",
        payload: {
          jkf: jkfB,
          cursor: cursorB,
          branchPlan: asBranchPlan([{ te: 1, forkIndex: 0 }]),
        },
      },
    );
    expect(replaced.jkf).toBe(jkfB);

    const restored = gameReducer(replaced, {
      type: "jkf_restored",
      payload: { jkf: jkfA, cursor: cursorA, branchPlan: asBranchPlan([]), expectedJkf: jkfB },
    });

    expect(restored.jkf).toBe(jkfA);
    expect(restored.cursor).toBe(cursorA);
    expect(restored.branchPlan).toEqual([]);
  });

  // 戻したことと、戻した理由は別々に伝わる必要がある。
  // ここで error を消すと、失敗を出した直後に自分で消すことになる。
  it("error は消さない", () => {
    const restored = gameReducer(
      { ...initialGameState, jkf: jkfB, error: "書き込みに失敗しました" },
      {
        type: "jkf_restored",
        payload: { jkf: jkfA, cursor: null, branchPlan: asBranchPlan([]), expectedJkf: jkfB },
      },
    );

    expect(restored.error).toBe("書き込みに失敗しました");
  });

  // 書き込みを待っている間に、別のファイルが読み込まれたり次の手が指されたりする。
  // 無条件に戻すと、その編集や読み込みを**巻き戻しが消す**。
  it("置いた棋譜がもう別物なら戻さない", () => {
    const jkfC = { header: {}, moves: [{}, {}, {}] };
    const now = { ...initialGameState, jkf: jkfC, cursor: cursorB };

    const restored = gameReducer(now, {
      type: "jkf_restored",
      // 置いたのは jkfB だったが、いまは jkfC（誰かが差し替えた）
      payload: { jkf: jkfA, cursor: cursorA, branchPlan: asBranchPlan([]), expectedJkf: jkfB },
    });

    expect(restored).toBe(now);
  });
});
