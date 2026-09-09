// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

/**
 * 盤の向きを戻す合図は、**盤に載っている棋譜**（`loadedAbsPath` と `boardSeq` の組）。
 * なぜツリー側のパスではないかは `../useResetOrientationOnKifuChange.ts` の doc にある。
 * セルの一覧は `docs/state-transitions/board-orientation.md`。
 *
 * ここでの決め事は2つ。
 *
 * **URL は本物を通す。** `useURLParams` を差し替えると、見たいもの（最終的に
 * `pov` が残るか）ではなく呼ばれた回数を見ることになる。同じ値の書き戻しは
 * 害が無いので、回数では合否を決められない。
 *
 * **向きは起動時の URL では作らない。** 実際の順序は「棋譜を開く → ボタンで回す」で、
 * 開いた時点で一度リセットが走る。`?pov=gote` で始める形はアプリに無い。
 *
 * **盤の中身が入れ替わった回数（`boardSeq`）も組にして動かす。** パスだけを動かすと改名になり、
 * 載せ直しの場合が1つも踏めなくなる。動かす口は `loadKifu` / `renameTo` / `closeKifu` の
 * 3つだけで、`game.state` を直に書かない。
 */

const game = { state: { loadedAbsPath: null as string | null, boardSeq: 0 } };

/** 棋譜が盤に載る（`game_loaded`）。パスと回数が組で動く */
function loadKifu(path: string) {
  game.state.loadedAbsPath = path;
  game.state.boardSeq += 1;
}

/** 改名・移動（`path_renamed`）。**パスだけが動き、回数は進まない** */
function renameTo(path: string) {
  game.state.loadedAbsPath = path;
}

/** 棋譜を閉じる（`reset_state`）。**盤が空へ入れ替わるので回数は進む** */
function closeKifu() {
  game.state.loadedAbsPath = null;
  game.state.boardSeq += 1;
}

vi.mock("@/entities/game", () => ({
  useGame: () => game,
}));

const { useBoardOrientation } = await import("../useBoardOrientation");
const { useResetOrientationOnKifuChange } = await import("../useResetOrientationOnKifuChange");

let search = "";
let isGotePov = false;

/** 見た location の鍵。`navigate` が撃たれるたびに増える */
const seenKeys: string[] = [];

/**
 * 向きを付ける口は解析ペインのヘッダ1つだけ。**そこが呼ぶのと同じ `toggle`** を
 * ボタンに繋ぐ。書き手を試験の側で組み直すと、符号化がずれても緑のままになる。
 *
 * 読む側と落とす側を同じ所で呼んでいるが、現物は別々に載っている——落とす側は
 * `BoardOrientationBridge`、読む側は `GameBoard`。載せ方の違いは
 * `src/widgets/game-board/ui/__tests__/gameBoardOrientation.test.tsx` と
 * `src/app/providers/__tests__/runtimeProvidersBridges.test.tsx` が固定する。
 */
function Probe() {
  const location = useLocation();
  search = location.search;
  if (seenKeys[seenKeys.length - 1] !== location.key) seenKeys.push(location.key);
  const orientation = useBoardOrientation();
  isGotePov = orientation.isGotePov;
  useResetOrientationOnKifuChange();
  return (
    <button type="button" onClick={orientation.toggle}>
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
  loadKifu(path);
  redraw(view);

  fireEvent.click(screen.getByRole("button", { name: "回す" }));
  expect(isGotePov).toBe(true);
  return view;
}

beforeEach(() => {
  game.state.loadedAbsPath = null;
  game.state.boardSeq = 0;
  search = "";
  isGotePov = false;
  seenKeys.length = 0;
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

    loadKifu("/ws/b.kif");
    redraw(view);

    expect(search).not.toContain("pov");
    expect(isGotePov).toBe(false);
  });

  /**
   * 表の E4（選択だけが動く）/ E5（選択が巻き戻る）/ E9（開いたが盤に載らない）。
   *
   * **3つとも同じ形に還元して見ている。** このフックは file-tree を読まないので、
   * どのイベントも「`loadedAbsPath` が動かない再描画」としてしか届かない。
   * ツリー側を組み立てても、このフックからは区別が付かない。
   * **還元が成り立つのは file-tree を読まない間だけ。** 読む形にするなら3つを分ける。
   */
  test("盤に載っている棋譜が変わらない再描画では、向きは変わらない", () => {
    const view = openAndRotate("/ws/a.kif");

    redraw(view);
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(isGotePov).toBe(true);
  });

  /**
   * `updateParams` は削除が空振りでも `navigate` する。`history.replace` は URL が
   * 同一でも新しい鍵を持つ location を作るので、`useLocation` の読み手
   * （ファイルツリー全行を含む）が同じ操作に対して2回描き直される。
   */
  test("消す `pov` が無ければ、棋譜が載っても履歴を触らない", () => {
    const view = render(app());
    expect(seenKeys).toHaveLength(1);

    loadKifu("/ws/a.kif");
    redraw(view);

    expect(seenKeys).toHaveLength(1);
  });

  /** 表の (B2, E3)。**戻す側**——ボタンは同じ1つで、押すたびに切り替わる */
  test("もう一度押すと先手側から見る", () => {
    openAndRotate("/ws/a.kif");

    fireEvent.click(screen.getByRole("button", { name: "回す" }));

    expect(search).not.toContain("pov");
    expect(isGotePov).toBe(false);
  });

  /**
   * 表の (B1, E1)。**既定のまま別の棋譜が載る場合。**
   * `pov` の落下は no-op なので、観測できるのは「履歴を触らないこと」だけ。
   */
  test("既定のまま別の棋譜が載っても、`pov` は付かず履歴も触らない", () => {
    const view = render(app());
    loadKifu("/ws/a.kif");
    redraw(view);
    expect(seenKeys).toHaveLength(1);

    loadKifu("/ws/b.kif");
    redraw(view);

    expect(search).not.toContain("pov");
    expect(seenKeys).toHaveLength(1);
  });

  /** 表の (B1, E2)。既定のまま閉じる */
  test("既定のまま棋譜を閉じても、履歴を触らない", () => {
    const view = render(app());
    loadKifu("/ws/a.kif");
    redraw(view);

    closeKifu();
    redraw(view);

    expect(search).not.toContain("pov");
    expect(seenKeys).toHaveLength(1);
  });

  /** 表の E2 */
  test("棋譜を閉じたら向きを既定へ戻す", () => {
    const view = openAndRotate("/ws/a.kif");

    closeKifu();
    redraw(view);

    expect(search).not.toContain("pov");
  });

  /**
   * 表の (B2, E7)。**改名・移動では向きを持ち越す。**
   *
   * 変わったのは名前だけで、盤に並んでいる駒は同じ。パスだけを見ていると
   * 「別の棋譜が載った」と読めてしまい、**名前を直しただけで盤が回る**。
   */
  test("改名・移動では向きを落とさない", () => {
    const view = openAndRotate("/ws/a.kif");

    renameTo("/ws/b.kif");
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(isGotePov).toBe(true);
  });

  /**
   * 表の (B1, E7)。**既定のまま改名する場合。** `pov` を落とさないことは
   * no-op と見分けが付かないので、観測できるのは「履歴を触らないこと」だけ。
   */
  test("既定のまま改名しても、`pov` は付かず履歴も触らない", () => {
    const view = render(app());
    loadKifu("/ws/a.kif");
    redraw(view);
    expect(seenKeys).toHaveLength(1);

    renameTo("/ws/b.kif");
    redraw(view);

    expect(search).not.toContain("pov");
    expect(seenKeys).toHaveLength(1);
  });

  /**
   * 表の (B2, E6)。**同じ棋譜を開き直しても、向きは持ち越す。**
   *
   * 向きは棋譜に付くので、同じ棋譜なら開き直しても同じ向きでよい。踏むのは
   * E16 のあとの復帰導線——盤に載せられない棋譜を開いたあと前の棋譜を選び直すと、
   * `loadedAbsPath` と同じパスで `game_loaded` が撃たれる。ここで落とすと、
   * **載せられない棋譜を1つ踏むたびに向きが戻る**。
   */
  test("同じ名前で載り直しても、向きを落とさない", () => {
    const view = openAndRotate("/ws/a.kif");

    loadKifu("/ws/a.kif");
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(isGotePov).toBe(true);
  });

  /**
   * **記録は載せ直しでも追いつく。** 同じ名前のまま載り直した回で回数を控えそこねると、
   * 次の改名で「回数が違う＝別の棋譜が載った」と読んで向きが落ちる。
   */
  test("同じ名前で載り直したあとの改名でも、向きを落とさない", () => {
    const view = openAndRotate("/ws/a.kif");

    loadKifu("/ws/a.kif");
    redraw(view);

    renameTo("/ws/b.kif");
    redraw(view);

    expect(search).toContain("pov=gote");
    expect(isGotePov).toBe(true);
  });

  /**
   * **閉じた回を改名と読ませない。** 閉じるのも「盤の中身が空へ入れ替わった」なので
   * `reset_state` は回数を進める。進めないと、閉じてから別の棋譜が載るまでの間に
   * パスだけが動いた形になり、改名と区別が付かなくなる。
   */
  test("閉じたあとに別の棋譜が載れば、向きは既定へ戻る", () => {
    const view = openAndRotate("/ws/a.kif");

    closeKifu();
    redraw(view);
    loadKifu("/ws/b.kif");
    redraw(view);

    expect(search).not.toContain("pov");
    expect(isGotePov).toBe(false);
  });
});
