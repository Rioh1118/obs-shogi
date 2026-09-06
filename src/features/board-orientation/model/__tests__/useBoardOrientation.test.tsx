// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤の向きを戻す合図は `activeKifuPath`。**ツリーの選択ではない。**
 *
 * 選択を見ていると、`openKifuNode` が読み込みに失敗して選択を巻き戻したときにも
 * 発火する。そのとき盤は前の棋譜のままなので、利用者から見ると
 * 「開けませんでした」と言われただけで盤が勝手に回る。
 *
 * **URL は本物を通す。** `useURLParams` を差し替えると、見たいもの（最終的に
 * `pov` が残るか）ではなく呼ばれた回数を見ることになる。同じ値の書き戻しは
 * 害が無いので、回数では合否を決められない。
 *
 * **向きは起動時の URL では作らない。** 実際の順序は「棋譜を開く → ボタンで回す」で、
 * 開いた時点で一度リセットが走る。`?pov=gote` で始める形はアプリに無い。
 */

const tree = {
  activeKifuPath: null as string | null,
  selectedNode: null as { id: string } | null,
};

vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => tree,
}));

const { useBoardOrientation } = await import("../useBoardOrientation");
const { useResetOrientationOnKifuChange } = await import("../useResetOrientationOnKifuChange");

let search = "";
let rotate = false;

/**
 * 向きを付ける口は解析ペインのヘッダ1つだけ。ここではボタンで代役を立てる。
 *
 * 読む側と落とす側を**同じ所で**呼んでいるが、現物は別々に載っている——落とす側は
 * `BoardOrientationBridge`、読む側は `GameBoard`。ここで見たいのは
 * 「どの合図で落ちるか」なので、載せ方の違いは
 * `widgets/game-board/ui/__tests__/gameBoardOrientation.test.tsx` と
 * `app/providers/__tests__/runtimeProvidersBridges.test.tsx` が別に固定する。
 */
function Probe() {
  const { updateParams } = useURLParams();
  search = useLocation().search;
  rotate = useBoardOrientation().rotate;
  useResetOrientationOnKifuChange();
  return (
    <button type="button" onClick={() => updateParams({ pov: "gote" }, { replace: true })}>
      回す
    </button>
  );
}

/**
 * **要素は毎回作り直す。** 同じ要素オブジェクトを `rerender` に渡すと、React は
 * 参照が変わっていないものとして部分木ごと描き直しを飛ばす。`tree` を書き換えても
 * フックが読み直さないので、テストは全て「何も起きない」を見ることになる。
 *
 * `MemoryRouter` は `initialEntries` をマウント時にしか読まないので、
 * 型と位置が同じなら履歴はそのまま残る。
 */
const app = () => (
  <MemoryRouter initialEntries={["/app"]}>
    <Probe />
  </MemoryRouter>
);

function redraw(view: ReturnType<typeof render>) {
  view.rerender(app());
}

/** 棋譜を開いて後手視点にする。ここまでは全ての場合に共通 */
function openAndRotate(path: string) {
  const view = render(app());
  tree.activeKifuPath = path;
  tree.selectedNode = { id: path };
  redraw(view);

  fireEvent.click(screen.getByRole("button", { name: "回す" }));
  expect(rotate).toBe(true);
  return view;
}

beforeEach(() => {
  tree.activeKifuPath = null;
  tree.selectedNode = null;
  search = "";
  rotate = false;
});

afterEach(() => cleanup());

describe("盤の向き", () => {
  /** 表の E3 */
  test("回すと後手側から見る", () => {
    openAndRotate("/ws/a.kif");

    expect(search).toContain("pov=gote");
  });

  /** 表の E1 */
  test("別の棋譜が盤に載ったら向きを既定へ戻す", () => {
    const view = openAndRotate("/ws/a.kif");

    tree.activeKifuPath = "/ws/b.kif";
    tree.selectedNode = { id: "/ws/b.kif" };
    redraw(view);

    expect(search).not.toContain("pov");
    expect(rotate).toBe(false);
  });

  /**
   * 読めない棋譜をクリックした形。`openKifuNode` は選択だけを巻き戻すので
   * `selectedNode` は動くが、`kifu_opened` は起きないので盤は前の棋譜のまま。
   *
   * 表の E4 / E5
   */
  test("読み込みに失敗して選択だけが動いても、向きは変わらない", () => {
    const view = openAndRotate("/ws/a.kif");

    tree.selectedNode = { id: "/ws/broken.kif" };
    redraw(view);
    tree.selectedNode = { id: "/ws/a.kif" };
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(rotate).toBe(true);
  });

  /** 表の E2 */
  test("棋譜を閉じたら向きを既定へ戻す", () => {
    const view = openAndRotate("/ws/a.kif");

    tree.activeKifuPath = null;
    tree.selectedNode = null;
    redraw(view);

    expect(search).not.toContain("pov");
  });
});
