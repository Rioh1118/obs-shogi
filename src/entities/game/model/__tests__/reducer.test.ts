import { describe, expect, it } from "vitest";

import { gameReducer } from "../reducer";
import { initialGameState } from "../types";

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
