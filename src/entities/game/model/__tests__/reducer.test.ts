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

  it("isLoading が同値なら set_loading で同じ state を返す", () => {
    const state = { ...initialGameState, isLoading: false };
    expect(gameReducer(state, { type: "set_loading", payload: false })).toBe(state);
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

    const idle = { ...initialGameState, isLoading: false };
    expect(gameReducer(idle, { type: "set_loading", payload: true }).isLoading).toBe(true);
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
      payload: { jkf: jkfA, cursor: cursorA, branchPlan: asBranchPlan([]) },
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
        payload: { jkf: jkfA, cursor: null, branchPlan: asBranchPlan([]) },
      },
    );

    expect(restored.error).toBe("書き込みに失敗しました");
    expect(restored.isLoading).toBe(false);
  });
});
