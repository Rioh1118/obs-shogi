// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { INSIDE_BOARD_SELECTOR } from "@/features/clear-board-selection";

/**
 * 盤の升と駒台は「盤の内側」の目印を実際に付ける。
 *
 * 目印を落としても盤は同じに見える。壊れるのは**盤の外を押したときに選択が
 * 外れなくなる**ことだけで、例外もエラー表示も出ない。目印を読む側は
 * `features/clear-board-selection` が固定しているので、ここでは**付ける側**を見る。
 */

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    view: { player: null, legalMoves: [] },
    state: { selectedPosition: null },
    selectHand: vi.fn(),
    clearSelection: vi.fn(),
    getCurrentTurn: () => 0,
  }),
}));

const { default: Square } = await import("../Square");
const { default: Hand } = await import("../Hand");

afterEach(() => cleanup());

describe("盤の内側の目印", () => {
  test("升が付ける", () => {
    const { container } = render(
      <Square x={7} y={7} index={0}>
        <span data-testid="駒" />
      </Square>,
    );

    expect(
      container.querySelector('[data-testid="駒"]')!.closest(INSIDE_BOARD_SELECTOR),
    ).not.toBeNull();
  });

  test("駒台が付ける", () => {
    const { container } = render(<Hand isSente={true} />);

    expect(container.querySelector(INSIDE_BOARD_SELECTOR)).not.toBeNull();
  });
});
