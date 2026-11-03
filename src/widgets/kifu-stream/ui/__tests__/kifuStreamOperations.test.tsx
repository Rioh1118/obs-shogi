// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";

/**
 * 棋譜の一覧から呼ぶ操作が、どの手のどの枝に向けて呼ばれるか。
 *
 * 入れ替えと削除は棋譜ファイルへすぐ書き込み、取り消しが無い。押した行と違う枝へ
 * 渡ると、利用者が確認した枝とは別の変化が消える。
 */

/** 本譜3手。2手目に変化が1本 */
const KIF = [
  "手合割：平手",
  "   1 ７六歩(77)",
  "   2 ３四歩(33)",
  "   3 ２六歩(27)",
  "",
  "変化：2手",
  "   2 ８四歩(83)",
  "",
].join("\n");

const jkf = parseKifuContentToJKF(KIF, "kif");

/**
 * 変化の中にさらに変化がある棋譜。2手目の変化1を選ぶと、3手目の行は
 * 変化1の線の手で、そこに変化が1本ぶら下がる
 */
const NESTED = parseKifuContentToJKF(
  [
    "手合割：平手",
    "   1 ７六歩(77)",
    "   2 ３四歩(33)",
    "   3 ２六歩(27)",
    "",
    "変化：2手",
    "   2 ８四歩(83)",
    "   3 ２六歩(27)",
    "",
    "変化：3手",
    "   3 ６八銀(79)",
    "",
  ].join("\n"),
  "kif",
);

/** 1手目にコメントが1つある棋譜 */
const COMMENTED = parseKifuContentToJKF(
  ["手合割：平手", "   1 ７六歩(77)", "*角道を開ける", "   2 ３四歩(33)", ""].join("\n"),
  "kif",
);

/** 2手目の変化1を選んだ計画 */
const SECOND_MOVE_FORK = [{ te: 2, forkIndex: 0 }];

type Result = { success: true; data: undefined } | { success: false; error: string };

const game = vi.hoisted(() => ({
  state: {
    jkf: null as unknown,
    cursor: { tesuu: 0, forkPointers: [], tesuuPointer: "0,[]" } as {
      tesuu: number;
      forkPointers: unknown[];
      tesuuPointer: string;
    },
    branchPlan: [] as unknown[],
    loadedAbsPath: "/ws/a.kif",
    boardSeq: 1,
    isLoading: false,
  },
  view: { player: null as unknown, totalMoves: 3 },
  goToIndex: vi.fn(),
  applyCursor: vi.fn(),
  deleteBranch: vi.fn<(q: DeleteQuery) => Promise<Result>>(),
  swapBranches: vi.fn<(q: SwapQuery) => Promise<Result>>(),
}));

/** 分岐メニューが重なりの最上位か。Escape を受けるかを決める */
const overlay = vi.hoisted(() => ({ isTop: true }));

/** 一覧を流した記録。happy-dom は寸法が0なので、流す先の計算ではなく呼ばれ方を見る */
const scroll = vi.hoisted(() => ({ calls: [] as { rowId: string; behavior: ScrollBehavior }[] }));

/** `revealRow` が読む時計。続けて動いたかを決める */
const clock = vi.hoisted(() => ({ now: 10_000 }));

vi.mock("@/widgets/kifu-stream/lib/scrollToRowSafeZone", async (importActual) => {
  const actual =
    await importActual<typeof import("@/widgets/kifu-stream/lib/scrollToRowSafeZone")>();
  const mocked = {
    ...actual,
    scrollToRowSafeZone: (_scroller: HTMLElement, rowEl: HTMLElement, behavior: ScrollBehavior) => {
      scroll.calls.push({ rowId: rowEl.id, behavior });
    },
  };
  return mocked satisfies typeof import("@/widgets/kifu-stream/lib/scrollToRowSafeZone");
});

vi.mock("@/entities/game", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: () => game as unknown as ReturnType<typeof actual.useGame>,
  };
  return mocked satisfies typeof import("@/entities/game");
});

vi.mock("@/shared/lib/overlayStack", async (importActual) => {
  const actual = await importActual<typeof import("@/shared/lib/overlayStack")>();
  // 返すのは「自分が最上位か」を答える関数。Escape は最上位の面だけが受ける
  const mocked = { ...actual, useOverlayLayer: () => () => overlay.isTop };
  return mocked satisfies typeof import("@/shared/lib/overlayStack");
});

vi.mock("@/features/kifu-comment-note/ui/KifuCommentNote", async (importActual) => {
  const actual =
    await importActual<typeof import("@/features/kifu-comment-note/ui/KifuCommentNote")>();
  // 中身は Lexical ごと立つので描かない。見るのは開いているかだけ
  const mocked = {
    ...actual,
    default: ({ open }: { open: boolean }) => <>{open && <div data-testid="note" />}</>,
  };
  return mocked satisfies typeof import("@/features/kifu-comment-note/ui/KifuCommentNote");
});

const { default: KifuStreamList } = await import("../KifuStreamList");

const ok: Result = { success: true, data: undefined };

/** 要素は毎回作り直す。同じ参照だと React が部分木ごと描き直しを飛ばす */
const app = () => <KifuStreamList />;

async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });
  return view;
}

function rowOf(te: number): HTMLElement {
  const row = document.getElementById(`kifu-row-${te}`);
  if (!row) throw new Error(`${te}手目の行が無い`);
  return row;
}

async function pressLeft(el: Element) {
  await act(async () => {
    fireEvent.pointerDown(el, { button: 0 });
  });
}

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function openForkMenu(te = 2) {
  await click(within(rowOf(te)).getByTitle("分岐を選択"));
  return screen.getByRole("menu", { name: `${te}手目の分岐` });
}

/** 分岐メニューの `nth` 番目（0 が本譜）の行の操作を開く */
async function openForkActions(nth: number, te = 2) {
  const menu = await openForkMenu(te);
  await pressLeft(within(menu).getAllByRole("button", { name: "分岐の操作" })[nth]);
  return screen.getByRole("menu", { name: "分岐の操作" });
}

beforeEach(() => {
  overlay.isTop = true;
  scroll.calls = [];
  clock.now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  game.state.cursor = { tesuu: 0, forkPointers: [], tesuuPointer: "0,[]" };
  game.state.branchPlan = [];
  game.state.jkf = jkf;
  game.state.boardSeq = 1;
  game.state.isLoading = false;
  game.view.player = { kifu: jkf, shogi: {} };
  game.goToIndex.mockReset();
  game.applyCursor.mockReset();
  game.deleteBranch.mockReset().mockResolvedValue(ok);
  game.swapBranches.mockReset().mockResolvedValue(ok);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 棋譜と計画を差し替える。一覧は `view.player.kifu` から組み直す */
function load(kifu: unknown, branchPlan: unknown[] = []) {
  game.state.jkf = kifu;
  game.state.branchPlan = branchPlan;
  game.view.player = { kifu, shogi: {} };
}

async function redraw(view: ReturnType<typeof render>) {
  await act(async () => {
    view.rerender(app());
  });
}

/** 次のフレームまで待つ。分岐メニューを閉じた後の焦点と位置合わせはそこで走る */
async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("一覧", () => {
  test("手数と総手数を出す", async () => {
    await mount();
    expect(screen.getByText("手数 0/3")).not.toBeNull();
  });

  test("棋譜が無ければ選ぶよう案内する", async () => {
    game.view.player = null;
    await mount();
    expect(screen.getByText("棋譜ファイルを選択してください")).not.toBeNull();
  });

  test("行を押すとその手へ動く", async () => {
    await mount();
    await click(rowOf(3));
    expect(game.goToIndex).toHaveBeenCalledWith(3);
  });

  test("書き込みの最中は行を押しても動かない", async () => {
    game.state.isLoading = true;
    await mount();
    await click(rowOf(3));
    expect(game.goToIndex).not.toHaveBeenCalled();
  });

  test("分岐のバッジは変化のある行にだけ出る", async () => {
    await mount();
    expect(within(rowOf(2)).queryByTitle("分岐を選択")).not.toBeNull();
    expect(within(rowOf(1)).queryByTitle("分岐を選択")).toBeNull();
    expect(within(rowOf(0)).queryByTitle("分岐を選択")).toBeNull();
  });
});

describe("分岐メニュー", () => {
  test("本譜と変化を並べ、選ばれている方に印を付ける", async () => {
    await mount();
    const items = within(await openForkMenu()).getAllByRole("menuitemradio");

    expect(items[0].textContent).toMatch(/^本譜☖３四歩/);
    expect(items[1].textContent).toMatch(/^変化1☖８四歩/);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  test("変化を選ぶと、その変化へ降りたカーソルを渡して閉じる", async () => {
    await mount();
    const menu = await openForkMenu();

    await pressLeft(within(menu).getAllByRole("menuitemradio")[1]);

    expect(game.applyCursor).toHaveBeenCalledWith({
      tesuu: 2,
      forkPointers: [{ te: 2, forkIndex: 0 }],
    });
    expect(game.goToIndex).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).toBeNull();
  });

  test("選ばれている本譜を押すと、その手へ動くだけ", async () => {
    await mount();
    const menu = await openForkMenu();

    await pressLeft(within(menu).getAllByRole("menuitemradio")[0]);

    expect(game.goToIndex).toHaveBeenCalledWith(2);
    expect(game.applyCursor).not.toHaveBeenCalled();
  });

  test("右ボタンでは選ばない", async () => {
    await mount();
    const menu = await openForkMenu();

    await act(async () => {
      fireEvent.pointerDown(within(menu).getAllByRole("menuitemradio")[1], { button: 2 });
    });

    expect(game.applyCursor).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).not.toBeNull();
  });

  test("Escape で閉じる", async () => {
    await mount();
    await openForkMenu();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).toBeNull();
  });

  /** 読み上げは `aria-controls` を辿って開いたメニューへ移る。指す先が無いと辿れない */
  test("開いたバッジは、開いたメニューを指す", async () => {
    await mount();
    const menu = await openForkMenu();

    const controls = within(rowOf(2)).getByTitle("分岐を選択").getAttribute("aria-controls");

    expect(controls).not.toBeNull();
    expect(document.getElementById(controls ?? "")).toBe(menu);
  });

  test("同じバッジをもう一度押すと閉じる", async () => {
    await mount();
    await openForkMenu();

    await click(within(rowOf(2)).getByTitle("分岐を選択"));

    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).toBeNull();
  });
});

describe("分岐の操作", () => {
  test("先頭の本譜は上へ動かせず、末尾の変化は下へ動かせない", async () => {
    await mount();
    const first = await openForkActions(0);
    expect(within(first).getByRole("menuitem", { name: "上へ" })).toHaveProperty("disabled", true);
    expect(within(first).getByRole("menuitem", { name: "下へ" })).toHaveProperty("disabled", false);

    cleanup();
    await mount();
    const last = await openForkActions(1);
    expect(within(last).getByRole("menuitem", { name: "上へ" })).toHaveProperty("disabled", false);
    expect(within(last).getByRole("menuitem", { name: "下へ" })).toHaveProperty("disabled", true);
  });

  test("変化を上へ動かすと、その変化と1つ上の枝を入れ替える", async () => {
    await mount();
    const actions = await openForkActions(1);

    await click(within(actions).getByRole("menuitem", { name: "上へ" }));

    expect(game.swapBranches).toHaveBeenCalledWith({ te: 2, forkPointers: [], a: 1, b: 0 });
    expect(screen.queryByRole("menu", { name: "分岐の操作" })).toBeNull();
  });

  test("本譜を下へ動かすと、本譜と変化1を入れ替える", async () => {
    await mount();
    const actions = await openForkActions(0);

    await click(within(actions).getByRole("menuitem", { name: "下へ" }));

    expect(game.swapBranches).toHaveBeenCalledWith({ te: 2, forkPointers: [], a: 0, b: 1 });
  });

  test("同じ行の操作をもう一度押すと閉じる", async () => {
    await mount();
    await openForkActions(1);
    const menu = screen.getByRole("menu", { name: "2手目の分岐" });

    await pressLeft(within(menu).getAllByRole("button", { name: "分岐の操作" })[1]);

    expect(screen.queryByRole("menu", { name: "分岐の操作" })).toBeNull();
  });

  test("行の右クリックでも開く", async () => {
    await mount();
    const menu = await openForkMenu();
    const rows = within(menu).getAllByRole("none");

    await act(async () => {
      fireEvent.contextMenu(rows[1]);
    });

    expect(screen.queryByRole("menu", { name: "分岐の操作" })).not.toBeNull();
  });
});

describe("削除の確認", () => {
  test("変化の削除は、確認を挟んでからその変化を消す", async () => {
    await mount();
    const actions = await openForkActions(1);

    await click(within(actions).getByRole("menuitem", { name: "削除" }));

    expect(game.deleteBranch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "2手目の変化1を削除しますか？" });
    expect(dialog.textContent).toMatch(/８四歩 から先（1手）が削除されます。/);

    await click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(game.deleteBranch).toHaveBeenCalledWith({ te: 2, forkPointers: [], target: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("行の操作の削除は、その手から先の本譜を消す", async () => {
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });

    const actions = screen.getByRole("menu", { name: "3手目の操作" });
    await click(within(actions).getByRole("menuitem", { name: "削除" }));

    const dialog = screen.getByRole("dialog", { name: "3手目の本譜を削除しますか？" });
    expect(dialog.textContent).toMatch(/２六歩 から先（1手）が削除されます。/);

    await click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(game.deleteBranch).toHaveBeenCalledWith({ te: 3, forkPointers: [], target: 0 });
  });

  test("開始局面の行は削除できない", async () => {
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(0));
    });

    const actions = screen.getByRole("menu", { name: "0手目の操作" });
    expect(within(actions).getByRole("menuitem", { name: "削除" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("失敗したら確認を閉じずに理由を出す", async () => {
    game.deleteBranch.mockResolvedValue({ success: false, error: "書き込めません" });
    await mount();
    const actions = await openForkActions(1);
    await click(within(actions).getByRole("menuitem", { name: "削除" }));

    const dialog = screen.getByRole("dialog", { name: "2手目の変化1を削除しますか？" });
    await click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(screen.getByRole("alert").textContent).toContain("書き込めません");
    expect(within(dialog).getByRole("button", { name: "削除する" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("閉じた後に失敗が返っても、同じ棋譜なら確認を開き直して理由を出す", async () => {
    let settle!: (r: Result) => void;
    game.deleteBranch.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    await mount();
    const actions = await openForkActions(1);
    await click(within(actions).getByRole("menuitem", { name: "削除" }));
    await click(screen.getByRole("button", { name: "削除する" }));

    await click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => settle({ success: false, error: "書き込めません" }));

    expect(screen.getByRole("dialog", { name: "2手目の変化1を削除しますか？" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("書き込めません");
  });

  test("閉じた後に棋譜が変わってから失敗が返ったら、確認を開き直さない", async () => {
    let settle!: (r: Result) => void;
    game.deleteBranch.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const view = await mount();
    const actions = await openForkActions(1);
    await click(within(actions).getByRole("menuitem", { name: "削除" }));
    await click(screen.getByRole("button", { name: "削除する" }));
    await click(screen.getByRole("button", { name: "閉じる" }));

    game.state.boardSeq = 2;
    await act(async () => {
      view.rerender(app());
    });
    await act(async () => settle({ success: false, error: "書き込めません" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("書いている間は、その確認だけが「削除中」になる", async () => {
    game.deleteBranch.mockReturnValue(new Promise(() => {}));
    await mount();
    const forkActions = await openForkActions(1);
    await click(within(forkActions).getByRole("menuitem", { name: "削除" }));
    await click(screen.getByRole("button", { name: "削除する" }));
    expect(screen.queryByText("削除中…")).not.toBeNull();

    await click(screen.getByRole("button", { name: "閉じる" }));
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    const moveActions = screen.getByRole("menu", { name: "3手目の操作" });
    await click(within(moveActions).getByRole("menuitem", { name: "削除" }));

    const dialog = screen.getByRole("dialog", { name: "3手目の本譜を削除しますか？" });
    expect(within(dialog).queryByText("削除中…")).toBeNull();
  });

  test("棋譜が入れ替わったら確認を閉じる", async () => {
    const view = await mount();
    const actions = await openForkActions(1);
    await click(within(actions).getByRole("menuitem", { name: "削除" }));

    game.state.boardSeq = 2;
    await act(async () => {
      view.rerender(app());
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(game.deleteBranch).not.toHaveBeenCalled();
  });
});

describe("開く面は1つだけ", () => {
  test("分岐メニューを開くと、行の操作とノートを閉じる", async () => {
    await mount();
    await click(within(rowOf(1)).getByTitle(/コメントを(開く|追加)/));
    expect(screen.queryByTestId("note")).not.toBeNull();

    await openForkMenu();

    expect(screen.queryByTestId("note")).toBeNull();
  });

  test("ノートを開くと、分岐メニューを閉じる", async () => {
    await mount();
    await openForkMenu();

    await click(within(rowOf(1)).getByTitle(/コメントを(開く|追加)/));

    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).toBeNull();
    expect(screen.queryByTestId("note")).not.toBeNull();
  });

  test("行の操作を開くと、分岐メニューとノートを閉じる", async () => {
    await mount();
    await click(within(rowOf(1)).getByTitle(/コメントを(開く|追加)/));

    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });

    expect(screen.queryByTestId("note")).toBeNull();
    expect(screen.queryByRole("menu", { name: "3手目の操作" })).not.toBeNull();
  });

  test("行を押してもノートは閉じない", async () => {
    await mount();
    await click(within(rowOf(1)).getByTitle(/コメントを(開く|追加)/));

    await click(rowOf(3));

    expect(screen.queryByTestId("note")).not.toBeNull();
  });

  test("ノートのボタンは開いている行でだけ押された形になる", async () => {
    await mount();
    await click(within(rowOf(1)).getByTitle(/コメントを(開く|追加)/));

    expect(
      within(rowOf(1))
        .getByTitle(/コメントを(開く|追加)/)
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(rowOf(2))
        .getByTitle(/コメントを(開く|追加)/)
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("行", () => {
  test("Enter でその手へ動く", async () => {
    await mount();
    await act(async () => {
      fireEvent.keyDown(rowOf(2), { key: "Enter" });
    });
    expect(game.goToIndex).toHaveBeenCalledWith(2);
  });

  test("コメントのある行は数を出し、ボタンの題を「開く」にする", async () => {
    load(COMMENTED);
    await mount();

    const withComment = within(rowOf(1)).getByTitle("コメントを開く");
    expect(withComment.textContent).toBe("1");
    expect(within(rowOf(2)).queryByTitle("コメントを追加")).not.toBeNull();
  });
});

describe("行の操作", () => {
  test("同じ行をもう一度右クリックすると閉じる", async () => {
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    expect(screen.queryByRole("menu", { name: "3手目の操作" })).toBeNull();
  });

  test("行を押すと閉じる", async () => {
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    await click(rowOf(1));
    expect(screen.queryByRole("menu", { name: "3手目の操作" })).toBeNull();
  });

  test("面の外を押すと閉じる", async () => {
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole("menu", { name: "3手目の操作" })).toBeNull();
  });

  test("書き込みの最中は右クリックで開かない", async () => {
    game.state.isLoading = true;
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    expect(screen.queryByRole("menu", { name: "3手目の操作" })).toBeNull();
  });
});

describe("分岐メニューの閉じ方", () => {
  /** 押下で外側と見て閉じると、続くクリックが開き直してバッジで閉じられなくなる */
  test("開いたバッジの押下からクリックまでで閉じる", async () => {
    await mount();
    await openForkMenu();
    const badge = within(rowOf(2)).getByTitle("分岐を選択");

    await pressLeft(badge);
    await click(badge);

    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).toBeNull();
  });

  test("上に別の面が重なっている間は Escape を受けない", async () => {
    await mount();
    await openForkMenu();
    overlay.isTop = false;

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByRole("menu", { name: "2手目の分岐" })).not.toBeNull();
  });

  test("Escape で閉じたらバッジへ焦点を戻す", async () => {
    await mount();
    await openForkMenu();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await nextFrame();

    expect(document.activeElement).toBe(within(rowOf(2)).getByTitle("分岐を選択"));
  });

  test("書き込みが始まった後は選べない", async () => {
    const view = await mount();
    const menu = await openForkMenu();
    game.state.isLoading = true;
    await redraw(view);

    await pressLeft(within(menu).getAllByRole("menuitemradio")[1]);

    expect(game.applyCursor).not.toHaveBeenCalled();
  });

  test("書き込みが始まった後は、行の右クリックで操作を開かない", async () => {
    const view = await mount();
    const menu = await openForkMenu();
    game.state.isLoading = true;
    await redraw(view);

    await act(async () => {
      fireEvent.contextMenu(within(menu).getAllByRole("none")[1]);
    });

    expect(screen.queryByRole("menu", { name: "分岐の操作" })).toBeNull();
  });

  /** 操作の面は開いたときの行の横に置くので、流すと別の行の横に残る */
  test("メニューを流すと操作の面を閉じる", async () => {
    await mount();
    await openForkActions(1);

    await act(async () => {
      fireEvent.scroll(screen.getByRole("menu", { name: "2手目の分岐" }));
    });

    expect(screen.queryByRole("menu", { name: "分岐の操作" })).toBeNull();
  });
});

describe("計画で変化を選んでいるとき", () => {
  test("バッジに選んだ変化の番号を出し、メニューで変化に印を付ける", async () => {
    load(NESTED, SECOND_MOVE_FORK);
    await mount();

    expect(within(rowOf(2)).getByTitle("分岐を選択").textContent).toBe("11");
    const items = within(await openForkMenu()).getAllByRole("menuitemradio");
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  test("ノートは選んだ変化の手で開く", async () => {
    load(NESTED, SECOND_MOVE_FORK);
    await mount();

    await click(within(rowOf(2)).getByTitle(/コメントを(開く|追加)/));

    expect(
      within(rowOf(2))
        .getByTitle(/コメントを(開く|追加)/)
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("変化の先の手を入れ替えると、そこまでに選んだ変化を添えて渡す", async () => {
    load(NESTED, SECOND_MOVE_FORK);
    await mount();
    const actions = await openForkActions(1, 3);

    await click(within(actions).getByRole("menuitem", { name: "上へ" }));

    expect(game.swapBranches).toHaveBeenCalledWith({
      te: 3,
      forkPointers: [{ te: 2, forkIndex: 0 }],
      a: 1,
      b: 0,
    });
  });

  test("変化の先の手を消すと、そこまでに選んだ変化を添えて渡す", async () => {
    load(NESTED, SECOND_MOVE_FORK);
    await mount();
    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    await click(
      within(screen.getByRole("menu", { name: "3手目の操作" })).getByRole("menuitem", {
        name: "削除",
      }),
    );
    await click(screen.getByRole("button", { name: "削除する" }));

    expect(game.deleteBranch).toHaveBeenCalledWith({
      te: 3,
      forkPointers: [{ te: 2, forkIndex: 0 }],
      target: 0,
    });
  });
});

describe("前の確認の削除が後から返ったとき", () => {
  /** 2手目の変化1の確認で削除を始め、閉じてから3手目の確認を開く */
  async function startThenOpenAnother() {
    let settle!: (r: Result) => void;
    game.deleteBranch.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    await mount();
    const actions = await openForkActions(1);
    await click(within(actions).getByRole("menuitem", { name: "削除" }));
    await click(screen.getByRole("button", { name: "削除する" }));
    await click(screen.getByRole("button", { name: "閉じる" }));

    await act(async () => {
      fireEvent.contextMenu(rowOf(3));
    });
    const moveActions = screen.getByRole("menu", { name: "3手目の操作" });
    await click(within(moveActions).getByRole("menuitem", { name: "削除" }));
    return settle;
  }

  test("書けても、いま出ている確認は閉じない", async () => {
    const settle = await startThenOpenAnother();

    await act(async () => settle(ok));

    expect(screen.queryByRole("dialog", { name: "3手目の本譜を削除しますか？" })).not.toBeNull();
  });

  test("失敗しても、いま出ている確認を押し退けない", async () => {
    const settle = await startThenOpenAnother();

    await act(async () => settle({ success: false, error: "書き込めません" }));

    expect(screen.queryByRole("dialog", { name: "3手目の本譜を削除しますか？" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain("書き込めません");
  });
});

describe("一覧の位置", () => {
  const moveCursorTo = (tesuu: number) => {
    game.state.cursor = { tesuu, forkPointers: [], tesuuPointer: `${tesuu},[]` };
  };

  test("カーソルが動いたら、その行を見える位置へ流す", async () => {
    const view = await mount();
    clock.now += 1000;
    moveCursorTo(2);
    await redraw(view);

    expect(scroll.calls[scroll.calls.length - 1]).toEqual({
      rowId: "kifu-row-2",
      behavior: "smooth",
    });
  });

  test("続けて動いたら smooth をやめて追従する", async () => {
    const view = await mount();
    clock.now += 50;
    moveCursorTo(2);
    await redraw(view);

    expect(scroll.calls[scroll.calls.length - 1]).toEqual({
      rowId: "kifu-row-2",
      behavior: "auto",
    });
  });

  test("Escape で閉じたら、分岐の行を見える位置へ戻す", async () => {
    await mount();
    await openForkMenu();
    clock.now += 1000;
    const before = scroll.calls.length;

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await nextFrame();

    expect(scroll.calls.slice(before)).toEqual([{ rowId: "kifu-row-2", behavior: "smooth" }]);
  });

  /** カーソル変化の effect が選んだ smooth を、開始直後に打ち切らない */
  test("直前に流していたら、閉じた後の位置合わせは譲る", async () => {
    await mount();
    await openForkMenu();
    clock.now += 50;
    const before = scroll.calls.length;

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await nextFrame();

    expect(scroll.calls.slice(before)).toEqual([]);
  });
});
