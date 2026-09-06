// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * 盤の向きは `GameBoard` が自分で取る。**呼び出し側から prop で降ってこない。**
 *
 * 対局者名を自力で取っている（`useFileTree`）のに向きだけ上から受け取るのは一貫していない。
 * prop で渡すと、渡し忘れても既定値で描けてしまい、**盤が回らなくなるだけで**
 * 型でもレンダでも落ちない。
 *
 * あわせて、`GameBoard` が向きを**落とす**側を持っていないことも見る。持たせると、
 * 棋譜を閉じて盤が unmount した瞬間に落とす者が居なくなり `?pov=gote` が残る。
 */

const tree = { jkfData: null as unknown, activeKifuPath: null as string | null };

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => tree,
}));

const { default: GameBoard } = await import("../GameBoard");

const app = (search: string) => (
  <MemoryRouter initialEntries={[`/app${search}`]}>
    <GameBoard topLeft={null} center={null} bottomRight={null} />
  </MemoryRouter>
);

beforeEach(() => {
  tree.jkfData = null;
  tree.activeKifuPath = null;
});

afterEach(() => cleanup());

describe("盤の向き（盤の側）", () => {
  test("`?pov=gote` なら盤が回る", () => {
    const { container } = render(app("?pov=gote"));

    expect(container.querySelector(".game-board--rotated")).not.toBeNull();
  });

  test("`pov` が無ければ既定（先手が手前）", () => {
    const { container } = render(app(""));

    expect(container.querySelector(".game-board--rotated")).toBeNull();
  });

  test("盤に載っている棋譜が変わっても、盤は `pov` を落とさない", () => {
    tree.activeKifuPath = "/ws/a.kif";
    const view = render(app("?pov=gote"));

    tree.activeKifuPath = "/ws/b.kif";
    view.rerender(app("?pov=gote"));

    expect(view.container.querySelector(".game-board--rotated")).not.toBeNull();
  });
});
