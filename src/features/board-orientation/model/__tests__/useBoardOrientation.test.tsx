// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤の向きを戻す合図は、**盤に載っている棋譜**（`loadedAbsPath`）。
 * ツリーが開いたと言っているパス（`activeKifuPath`）ではない。
 *
 * ツリー側を見ると、盤に載せられない棋譜をクリックしたときにも発火する。
 * `openKifuNode` は構文として読めれば通すので `activeKifuPath` は動くが、
 * その先の `loadGame` が落ちると盤は前の棋譜のまま。利用者から見ると、
 * 何も言われないのに盤が回る。
 *
 * **URL は本物を通す。** `useURLParams` を差し替えると、見たいもの（最終的に
 * `pov` が残るか）ではなく呼ばれた回数を見ることになる。同じ値の書き戻しは
 * 害が無いので、回数では合否を決められない。
 *
 * **向きは起動時の URL では作らない。** 実際の順序は「棋譜を開く → ボタンで回す」で、
 * 開いた時点で一度リセットが走る。`?pov=gote` で始める形はアプリに無い。
 */

const game = { state: { loadedAbsPath: null as string | null } };

vi.mock("@/entities/game", () => ({
  useGame: () => game,
}));

const { useBoardOrientation } = await import("../useBoardOrientation");
const { useResetOrientationOnKifuChange } = await import("../useResetOrientationOnKifuChange");

let search = "";
let rotate = false;

/**
 * 向きを付ける口は解析ペインのヘッダ1つだけ。ここではボタンで代役を立てる。
 *
 * 読む側と落とす側を同じ所で呼んでいるが、現物は別々に載っている——落とす側は
 * `BoardOrientationBridge`、読む側は `GameBoard`。載せ方の違いは
 * `src/widgets/game-board/ui/__tests__/gameBoardOrientation.test.tsx` と
 * `src/app/providers/__tests__/runtimeProvidersBridges.test.tsx` が固定する。
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
 * 参照が変わっていないものとして部分木ごと描き直しを飛ばす。`game` を書き換えても
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

/** 棋譜を盤に載せて後手視点にする。ここまでは全ての場合に共通 */
function openAndRotate(path: string) {
  const view = render(app());
  game.state.loadedAbsPath = path;
  redraw(view);

  fireEvent.click(screen.getByRole("button", { name: "回す" }));
  expect(rotate).toBe(true);
  return view;
}

beforeEach(() => {
  game.state.loadedAbsPath = null;
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

    game.state.loadedAbsPath = "/ws/b.kif";
    redraw(view);

    expect(search).not.toContain("pov");
    expect(rotate).toBe(false);
  });

  /**
   * 盤に載らなかった形。ツリーの選択も `activeKifuPath` も動くが、`loadGame` が
   * 落ちるので `game_loaded` は出ず、`loadedAbsPath` は前の棋譜のまま。
   *
   * 表の E4 / E5 / E9
   */
  test("ツリー側だけが動いて盤に載らなければ、向きは変わらない", () => {
    const view = openAndRotate("/ws/a.kif");

    redraw(view);
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(rotate).toBe(true);
  });

  /** 表の E2 */
  test("棋譜を閉じたら向きを既定へ戻す", () => {
    const view = openAndRotate("/ws/a.kif");

    game.state.loadedAbsPath = null;
    redraw(view);

    expect(search).not.toContain("pov");
  });
});
