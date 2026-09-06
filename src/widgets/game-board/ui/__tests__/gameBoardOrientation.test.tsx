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
 * あわせて、`GameBoard` が向きを**落とす**側を持っていないことも見る（持たせると何が
 * 壊れるかは `BoardOrientationBridge` の doc）。
 * ここで動かせるのは `GameBoard` が読むもの（`useFileTree` の `jkfData`）だけなので、
 * **見ているのは「盤が自分から `pov` を触らない」まで。** 合図（`loadedAbsPath`）で
 * 落ちる／落ちないは `src/features/board-orientation/model/__tests__/` が持つ。
 */

const tree = { jkfData: null as unknown };

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

  test("描き直しても、盤は自分から `pov` を落とさない", () => {
    tree.jkfData = { header: { 先手: "a" } };
    const view = render(app("?pov=gote"));

    tree.jkfData = { header: { 先手: "b" } };
    view.rerender(app("?pov=gote"));

    expect(view.container.querySelector(".game-board--rotated")).not.toBeNull();
  });
});
