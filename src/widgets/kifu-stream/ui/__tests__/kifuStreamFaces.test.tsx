// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";

/**
 * **開いている面を畳む合図は `boardSeq` で、`loadedAbsPath` ではない。**
 *
 * 畳むのは盤の中身が入れ替わったときだけ。パスは改名・移動でも動くので、そちらで畳むと
 * **名前を直しただけで書きかけのノートが閉じる**——閉じると `KifuCommentNote` の
 * 離脱時の保存が走り、面がもう外れているぶん断りも出ないまま本文が消える。
 *
 * ノートの中身は見ない（Lexical ごと立てることになる）。見るのは
 * **開いたままか、閉じたか**と、渡している棋譜の識別子だけ。
 */

/** 本譜2手。行が組めれば十分なので、変化は要らない */
const jkf = parseKifuContentToJKF(
  ["手合割：平手", "   1 ７六歩(77)", "   2 ３四歩(33)", ""].join("\n"),
  "kif",
);

const game = {
  state: {
    jkf,
    cursor: { tesuu: 0, forkPointers: [], tesuuPointer: "0,[]" },
    branchPlan: [],
    loadedAbsPath: "/ws/a.kif" as string | null,
    boardSeq: 1,
    isLoading: false,
  },
  // 一覧は `view.player.kifu` から再生用の player を組み直す
  view: { player: { kifu: jkf, shogi: {} } },
  getTotalMoves: () => 2,
  goToIndex: vi.fn(),
  applyCursor: vi.fn(),
  deleteBranch: vi.fn(),
  swapBranches: vi.fn(),
};

vi.mock("@/entities/game", () => ({ useGame: () => game }));
// `useOverlayLayer` が返すのは**関数**（「自分が最上位か」を答える）。
// 数値を返すと、分岐メニューを開いて Escape を送るテストを足した瞬間に
// `isTop is not a function` になり、書いた人は Escape の扱いが壊れたと読む
vi.mock("@/shared/lib/overlayStack", () => ({ useOverlayLayer: () => () => true }));

/** 中身は見ない。**開いているか**と、渡された棋譜の識別子だけを出す */
vi.mock("@/features/kifu-comment-note/ui/KifuCommentNote", () => ({
  default: ({ open, boardSeq }: { open: boolean; boardSeq: number | null }) =>
    open ? <div data-testid="note" data-board-seq={String(boardSeq)} /> : null,
}));

const { default: KifuStreamList } = await import("../KifuStreamList");

/** 要素は毎回作り直す。同じ参照だと React が部分木ごと描き直しを飛ばす */
const app = () => <KifuStreamList />;

async function openNote() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });

  const buttons = screen.getAllByTitle(/コメントを(開く|追加)/);
  await act(async () => {
    buttons[0].click();
  });
  expect(screen.queryByTestId("note"), "前提: ノートが開いていない").not.toBeNull();
  return view;
}

async function redraw(view: ReturnType<typeof render>) {
  await act(async () => {
    view.rerender(app());
  });
}

beforeEach(() => {
  game.state.loadedAbsPath = "/ws/a.kif";
  game.state.boardSeq = 1;
});

afterEach(() => cleanup());

describe("開いている面を畳む合図", () => {
  /** 改名・移動（`path_renamed`）。パスだけが動き、盤の中身は同じ */
  test("改名・移動では、開いているノートを畳まない", async () => {
    const view = await openNote();

    game.state.loadedAbsPath = "/ws/b.kif";
    await redraw(view);

    expect(screen.queryByTestId("note")).not.toBeNull();
  });

  /**
   * 別の棋譜が載る（`game_loaded`）。畳まないと、ノートは同じ位置に開いたまま
   * **前の棋譜の本文を出し続ける**——見出しは手数しか出さないので、どのファイルのものかは
   * 画面から読めない。
   */
  test("別の棋譜が盤に載ったら、開いているノートを畳む", async () => {
    const view = await openNote();

    game.state.loadedAbsPath = "/ws/b.kif";
    game.state.boardSeq = 2;
    await redraw(view);

    expect(screen.queryByTestId("note")).toBeNull();
  });

  /** 同じ名前で載り直した回（E16 のあとの復帰）も、中身は入れ替わっている */
  test("同じ名前で載り直しても、開いているノートを畳む", async () => {
    const view = await openNote();

    game.state.boardSeq = 2;
    await redraw(view);

    expect(screen.queryByTestId("note")).toBeNull();
  });

  /**
   * ノートへ渡すのも `boardSeq`。**パスを渡すと、改名で `faceKey` が変わって
   * 面が別物として組み直され、書きかけの本文がそこで捨てられる。**
   */
  test("ノートへ渡す識別子は、改名で変わらない", async () => {
    const view = await openNote();
    // **値そのものを言う。** 前後の一致だけを見ると、`null` を渡す退行
    // （ノートが面を作れず、コメントが1文字も保存できなくなる）が
    // 「前も後も null」で通ってしまう
    expect(screen.getByTestId("note").getAttribute("data-board-seq")).toBe("1");

    game.state.loadedAbsPath = "/ws/b.kif";
    await redraw(view);

    expect(screen.getByTestId("note").getAttribute("data-board-seq")).toBe("1");
  });
});
