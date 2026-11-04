// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Ok } from "@/shared/lib/result";
import type { BookContextType, BookFailure, BookRow, BookViewState } from "@/entities/book";

/**
 * 定跡ビューが、状態ごとに1つのことだけを言うこと
 * （`docs/state-transitions/book-view.md` の不変条件2）。
 *
 * 文言そのものを固定する。引けなかったときに「この局面はこの定跡にありません」と出す形が
 * 実際に在り、それはこの画面でいちばん誤解が高くつく。利用者は定跡の中身についての事実
 * として読み、自分の定跡を誤って判断する。
 * 状態の綴りだけを見ると、割り当てを入れ替える変異が緑で通る。
 *
 * 状態そのものの遷移は `entities/book/model/__tests__/provider.test.tsx`。
 */

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const book = {
  info: null,
  view: { kind: "closed" } as BookViewState,
  failure: null as BookFailure | null,
  openBook: vi.fn(),
  close: vi.fn(),
  reportError: vi.fn(),
} satisfies Partial<BookContextType> as unknown as BookContextType;

vi.mock("@/entities/book", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/book")>()),
  useBook: () => book,
}));
vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { cursor: { tesuu: 4 } },
    view: { currentSfen: INITIAL_SFEN },
  }),
}));
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { book_recent_paths: [] }, setDisplayConfig: vi.fn() }),
}));
const presetsState = { presets: [] as unknown[], selectedPresetId: null as string | null };
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => ({ state: presetsState }),
}));

const { pickBookFile } = vi.hoisted(() => ({ pickBookFile: vi.fn() }));
vi.mock("@/shared/api/picker/pickBookFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/picker/pickBookFile")>();
  const mocked = { ...actual, pickBookFile };
  return mocked satisfies typeof import("@/shared/api/picker/pickBookFile");
});

const { default: BookView } = await import("../BookView");

function show(view: BookViewState, failure: BookFailure | null = null) {
  book.view = view;
  book.failure = failure;
  return render(<BookView />).container.textContent ?? "";
}

const failed = (origin: BookFailure["origin"]): BookFailure => ({
  origin,
  error: { code: "io", message: `${origin} が落ちた`, path: null },
});

afterEach(() => cleanup());

describe("定跡ビューの状態と文言", () => {
  test("定跡を開いていないときは、開く導線を出す", () => {
    expect(show({ kind: "closed" })).toContain("別の定跡を開く");
  });

  /** プリセット編集の定跡の欄と同じ答え（`bookInUse`）。「使わない」の定跡をここにだけ残さない */
  test("選んでいるプリセットの定跡は、使うときだけ勧める", () => {
    const preset = { id: "p1", label: "研究", bookFilePath: "/ai/hao/book/user_book1.db" };
    presetsState.selectedPresetId = "p1";
    try {
      presetsState.presets = [{ ...preset, bookEnabled: true }];
      expect(show({ kind: "closed" })).toContain("研究 の定跡");
      cleanup();
      presetsState.presets = [{ ...preset, bookEnabled: false }];
      expect(show({ kind: "closed" })).not.toContain("研究 の定跡");
    } finally {
      presetsState.presets = [];
      presetsState.selectedPresetId = null;
    }
  });

  /** GB 級は数分返らない。無効になったボタンだけだと押し損ねたと読まれる */
  test("開いている最中は、開こうとしているファイル名を出す", () => {
    const text = show({ kind: "opening", path: "/books/user_book1.db" });

    expect(text).toContain("user_book1.db");
    expect(text).toContain("開いています");
  });

  test("引いている最中は、引いていることを出す", () => {
    expect(show({ kind: "looking" })).toContain("引いています");
  });

  /**
   * 取り違えのいちばん高くつくところ。
   *
   * 割り当てを入れ替える変異（`unavailable` に `absent` の文言を割り当てる）は
   * ここで落ちる。
   */
  test("定跡に無いのと、引けなかったのを別の文言で出す", () => {
    const absent = show({ kind: "absent" });
    cleanup();
    const unavailable = show({ kind: "unavailable" });

    expect(absent).toContain("この定跡にありません");
    expect(unavailable).not.toContain("この定跡にありません");
    expect(unavailable).toContain("引けませんでした");
  });

  test("盤に局面が無いときは、次にやることまで出す", () => {
    const text = show({ kind: "noPosition" });

    expect(text).not.toContain("引いています");
    // **この画面から棋譜は開けない。** 何をすれば候補手が出るのかを言わないと、
    // 定跡は開いているのに止まった画面になる
    expect(text).toContain("棋譜");
  });

  /**
   * 行が並んでいるのに「読めませんでした」と言わない。
   * 行が出ているのは引けたということなので、落ちたのは先を辿る側だけ。
   */
  test("失敗の題は、落ちた操作から出る", () => {
    const rows: BookViewState = {
      kind: "rows",
      rows: [
        {
          move: { usiMove: "7g7f", ponder: null, value: 42, depth: 32, count: 5 },
          line: { state: "failed" },
        },
      ],
    };

    expect(show(rows, failed("walk"))).toContain("辿れませんでした");
    cleanup();

    // **同じ画面（行が並んでいる）でも、落ちたのが別の操作なら題は別。**
    // 題を画面の状態から引くと、開き損ねた回に「辿れませんでした」が付き、
    // 題と本文が1つの帯の中で食い違う
    const opening = show(rows, failed("open"));
    expect(opening).not.toContain("辿れませんでした");
    expect(opening).toContain("開けませんでした");
    cleanup();

    expect(show(rows, failed("external"))).not.toContain("辿れませんでした");
  });

  /** 辿るのをやめた後に「辿っています」と言わない（不変条件3） */
  test("辿れなかった行は、まだ辿っている行と別の綴りになる", () => {
    const move = { usiMove: "7g7f", ponder: null, value: null, depth: null, count: null };
    const failed = show({ kind: "rows", rows: [{ move, line: { state: "failed" } }] });
    cleanup();
    const pending = show({ kind: "rows", rows: [{ move, line: { state: "pending" } }] });

    expect(failed).not.toBe(pending);
  });

  test("失敗の本文にパスがあれば添える", () => {
    const withPath: BookFailure = {
      origin: "open",
      error: { code: "io", message: "読めない", path: "/books/a.db" },
    };

    expect(show({ kind: "closed" }, withPath)).toContain("読めない（/books/a.db）");
    cleanup();
    expect(show({ kind: "closed" }, failed("open"))).not.toContain("（");
  });
});

describe("定跡ビューの並べ替え", () => {
  const rows: BookRow[] = [
    {
      move: { usiMove: "2g2f", ponder: null, value: -5, depth: null, count: null },
      line: { state: "pending" },
    },
    {
      move: { usiMove: "7g7f", ponder: null, value: 42, depth: null, count: null },
      line: { state: "pending" },
    },
  ];
  const rowsView: BookViewState = { kind: "rows", rows };

  /** 並べ替えはこの画面が持つ。表へ返した並びが次の描画に効かないと、見出しを押しても動かない */
  test("見出しを押すと表の並びが変わる", () => {
    book.view = rowsView;
    book.failure = null;
    const { container } = render(<BookView />);
    const firstMove = () => container.querySelector("tbody td")?.textContent;

    expect(firstMove()).toBe("☗２六歩");
    fireEvent.click(screen.getByRole("button", { name: /評価/ }));
    expect(firstMove()).toBe("☗７六歩");
  });

  test("この先の列は盤の手数を土台にする", () => {
    const view: BookViewState = {
      kind: "rows",
      rows: [
        {
          ...rows[0],
          line: { state: "walked", line: { usiMove: "2g2f", plies: 2, stopped: "outOfBook" } },
        },
      ],
    };

    expect(show(view)).toContain("→ 6手目");
  });
});

describe("定跡ビューの失敗の帯", () => {
  const rows: BookViewState = {
    kind: "rows",
    rows: [
      {
        move: { usiMove: "7g7f", ponder: null, value: null, depth: null, count: null },
        line: { state: "pending" },
      },
    ],
  };

  test("引くのに落ちたら、引けなかったと題に出す", () => {
    const text = show(rows, failed("lookup"));

    expect(text).toContain("この局面を引けませんでした");
    expect(text).not.toContain("辿れませんでした");
  });

  /** 読み書きの失敗は押し直しで直りうるが、ファイルが無いのは直らない（ADR-0004） */
  test("帯の段は失敗の種類から決まる", () => {
    show(rows, failed("open"));
    expect(screen.getByRole("status").textContent).toContain("open が落ちた");
    cleanup();

    show(rows, { origin: "open", error: { code: "not_found", message: "無い", path: null } });
    expect(screen.getByRole("alert").textContent).toContain("無い");
  });
});

describe("定跡ビューの空の画面の押下", () => {
  const preset = (id: string, label: string, bookFilePath: string) => ({
    id,
    label,
    bookFilePath,
    bookEnabled: true,
  });

  test("選んでいるプリセットの定跡を勧め、押すとそのパスを開く", async () => {
    presetsState.presets = [
      preset("p1", "一番目", "/ai/one.db"),
      preset("p2", "二番目", "/ai/two.db"),
    ];
    presetsState.selectedPresetId = "p2";
    vi.mocked(book.openBook).mockResolvedValue(Ok(null));
    try {
      const text = show({ kind: "closed" });
      expect(text).toContain("二番目 の定跡");
      expect(text).not.toContain("一番目");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /two\.db/ }));
      });
      expect(book.openBook).toHaveBeenCalledWith("/ai/two.db");
    } finally {
      presetsState.presets = [];
      presetsState.selectedPresetId = null;
      vi.mocked(book.openBook).mockReset();
    }
  });

  test("別の定跡を開くはダイアログで選んだパスを開く", async () => {
    pickBookFile.mockResolvedValue("/books/picked.db");
    vi.mocked(book.openBook).mockResolvedValue(Ok(null));
    try {
      show({ kind: "closed" });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /別の定跡を開く/ }));
      });
      expect(book.openBook).toHaveBeenCalledWith("/books/picked.db");
    } finally {
      vi.mocked(book.openBook).mockReset();
    }
  });
});
