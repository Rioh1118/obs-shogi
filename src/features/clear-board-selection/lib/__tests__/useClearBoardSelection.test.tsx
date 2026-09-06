// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * 盤の外を押したら選択が外れる。**盤の内側では外れない。**
 *
 * 内側かどうかは目印1組で決まっていて、付ける側（`Square` / `Hand`）と読む側は
 * 別のファイルに居る。綴りがずれても型でもレンダでも落ちない——盤の外を押しても
 * 選択が外れなくなるだけで、例外もエラー表示も出ない。
 *
 * **目印は現物を通す。** 文字列を書き写すと、書き写した側だけが正しいテストになる。
 */

const game = {
  state: { selectedPosition: null as unknown },
  clearSelection: vi.fn(),
};

vi.mock("@/entities/game", () => ({
  useGame: () => game,
}));

const { useClearBoardSelection } = await import("../useClearBoardSelection");
const { boardSquareMarker, handAreaMarker } = await import("../boardMarkers");

/** ページの根で capture する形をそのまま作る */
function Page() {
  const onPointerDownCapture = useClearBoardSelection();
  return (
    <div onPointerDownCapture={onPointerDownCapture}>
      <div {...boardSquareMarker}>
        <span data-testid="駒" />
      </div>
      <div {...handAreaMarker} data-testid="駒台" />
      <div data-testid="盤の外" />
    </div>
  );
}

beforeEach(() => {
  game.state.selectedPosition = { type: "square", x: 7, y: 7 };
  game.clearSelection = vi.fn();
});

afterEach(() => cleanup());

describe("盤の外を押したら選択を外す", () => {
  test("盤の外なら外す", () => {
    render(<Page />);

    fireEvent.pointerDown(screen.getByTestId("盤の外"));

    expect(game.clearSelection).toHaveBeenCalledTimes(1);
  });

  test("升の中なら外さない", () => {
    render(<Page />);

    fireEvent.pointerDown(screen.getByTestId("駒"));

    expect(game.clearSelection).not.toHaveBeenCalled();
  });

  test("駒台なら外さない", () => {
    render(<Page />);

    fireEvent.pointerDown(screen.getByTestId("駒台"));

    expect(game.clearSelection).not.toHaveBeenCalled();
  });

  test("そもそも選んでいなければ何もしない", () => {
    game.state.selectedPosition = null;
    render(<Page />);

    fireEvent.pointerDown(screen.getByTestId("盤の外"));

    expect(game.clearSelection).not.toHaveBeenCalled();
  });
});
