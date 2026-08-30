// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Err, Ok } from "@/shared/lib/result";
import type { CursorPath } from "@/entities/kifu/model/cursor";

/**
 * ノートは**書けたときだけ**「保存済み」を出し、**開いた棋譜へだけ**書く。
 *
 * どちらが破れても、利用者は保存されたと信じたまま本文を失う。
 * - 失敗を成功と表示する → #227
 * - 棋譜を切り替えたあとに前の本文を次のファイルへ書く → #204
 */

const setCommentsByCursor = vi.fn();
const gameState = { loadedAbsPath: "/ws/a.kif" as string | null };
/** メモリの棋譜が持つコメント。`edit` は書き込みの前にここを更新する */
let comments: string[] = [];

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: gameState,
    getCommentsByCursor: () => comments,
    setCommentsByCursor: (...a: unknown[]) => setCommentsByCursor(...a),
  }),
}));

// Lexical は happy-dom で組み立てられないので、本文の入口だけを持つ板に差し替える。
//
// **`initialMarkdown` は捨てない。** Lexical は `initialConfig` を mount 時にしか読まないので、
// 「エディタが何で組まれたか」は mount 時の値そのもの。捨てると、
// **移った先のエディタが前の手の本文で mount される**形をテストが1本も見なくなる。
function EditorStub({
  initialMarkdown,
  onMarkdownChange,
}: {
  initialMarkdown?: string;
  onMarkdownChange?: (s: string) => void;
}) {
  // **mount 時の値で固定する。** 再レンダで追随させると、Lexical が
  // `initialConfig` を1回しか読まないという肝心の性質を再現しない。
  const [mounted] = useState(initialMarkdown ?? "");
  return (
    <textarea
      data-testid="editor"
      data-mounted-with={mounted}
      defaultValue={mounted}
      onChange={(e) => onMarkdownChange?.(e.target.value)}
    />
  );
}

vi.mock("@/shared/ui/live-markdown-note/LiveMarkdownNote", () => ({
  default: (props: { initialMarkdown?: string; onMarkdownChange?: (s: string) => void }) => (
    <EditorStub {...props} />
  ),
}));

/** エディタが**何で mount されたか**。Lexical は初期値しか読まない */
function mountedWith() {
  return screen.getByTestId("editor").getAttribute("data-mounted-with") ?? "";
}

vi.mock("@/shared/ui/floating-note/FloatingNote", () => ({
  default: ({
    open,
    children,
    onClose,
  }: {
    open: boolean;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <button data-testid="close" onClick={onClose}>
          close
        </button>
        {children}
      </div>
    ) : null,
}));

const { default: KifuCommentNote } = await import("../KifuCommentNote");

const CURSOR: CursorPath = {
  tesuu: 5,
  forkPointers: [],
};

function open(absPath: string | null) {
  return render(
    <KifuCommentNote open cursor={CURSOR} absPath={absPath} anchorEl={null} onClose={() => {}} />,
  );
}

async function type(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByTestId("editor"), { target: { value: text } });
  });
}

/** 900ms のデバウンスを待たずに autosave を撃つ */
async function typeAndAutosave(text: string) {
  await type(text);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  gameState.loadedAbsPath = "/ws/a.kif";
  comments = [];
  setCommentsByCursor.mockResolvedValue(Ok(undefined));
});

describe("保存の失敗", () => {
  it("失敗したら「保存済み」を出さず、理由を出す", async () => {
    setCommentsByCursor.mockResolvedValue(Err("Permission denied (os error 13)"));
    open("/ws/a.kif");

    await typeAndAutosave("メモ");

    expect(screen.queryByText("保存済み")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("保存できませんでした");
    expect(screen.getByRole("alert").textContent).toContain("Permission denied");
  });

  // **これが #227 の核。** 失敗しても baseText を進めると dirty が落ち、
  // autosave も閉じるときの保存も二度と走らない。閉じた時点で本文が消える。
  // 「保存済みを出さない」だけでは足りない（出さずに本文だけ失う形が通る）。
  it("失敗したあと、何も書き足さずに閉じても保存をやり直す", async () => {
    setCommentsByCursor.mockResolvedValue(Err("boom"));
    open("/ws/a.kif");

    await typeAndAutosave("メモ");
    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);

    // 閉じる要求。dirty が落ちていれば保存は試みられない
    setCommentsByCursor.mockResolvedValue(Ok(undefined));
    await act(async () => {
      screen.getByTestId("close").click();
    });

    expect(setCommentsByCursor).toHaveBeenCalledTimes(2);
    expect(setCommentsByCursor.mock.calls[1][1]).toEqual(["メモ"]);
  });

  it("メモリの棋譜が動いても、書けていない下書きを「保存済み」の側へ寄せない", async () => {
    // `edit` は楽観的更新で、書き込みの前に `jkf_replaced` を撃つ。
    // その結果 `getCommentsByCursor` が新しい本文を返すようになるが、
    // それを baseText へ入れると dirty が落ちて上と同じ失われ方をする。
    setCommentsByCursor.mockResolvedValue(Err("boom"));
    const view = open("/ws/a.kif");

    await typeAndAutosave("メモ");

    // 書き込みは失敗したが、メモリの棋譜には入った。
    // `useGame()` はモックなので、再レンダを起こさないと `sourceText` が動かない
    comments = ["メモ"];
    await act(async () => {
      view.rerender(
        <KifuCommentNote
          open
          cursor={CURSOR}
          absPath="/ws/a.kif"
          anchorEl={null}
          onClose={() => {}}
        />,
      );
    });

    setCommentsByCursor.mockResolvedValue(Ok(undefined));
    await act(async () => {
      screen.getByTestId("close").click();
    });

    expect(setCommentsByCursor).toHaveBeenCalledTimes(2);
  });

  it("失敗しても下書きは捨てない。書き足した全文で保存し直す", async () => {
    setCommentsByCursor.mockResolvedValue(Err("boom"));
    open("/ws/a.kif");

    await typeAndAutosave("メモ");
    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);

    setCommentsByCursor.mockResolvedValue(Ok(undefined));
    await typeAndAutosave("メモを書き足した");

    expect(setCommentsByCursor).toHaveBeenCalledTimes(2);
    expect(setCommentsByCursor.mock.calls[1][1]).toEqual(["メモを書き足した"]);
  });

  it("成功したら「保存済み」を出す", async () => {
    open("/ws/a.kif");
    await typeAndAutosave("メモ");

    expect(screen.getByText("保存済み")).toBeTruthy();
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
  });
});

describe("開いた棋譜との突き合わせ", () => {
  it("棋譜が差し替わったあとは書かない", async () => {
    // エディタを作り直す前に autosave が撃つ競合が残るので、鍵だけでは塞がらない。
    // 書いてしまうと、前のファイルの本文が**次のファイルの同じ手数へ**入る。
    open("/ws/a.kif");
    gameState.loadedAbsPath = "/ws/b.kif";

    await typeAndAutosave("A のメモ");

    expect(setCommentsByCursor).not.toHaveBeenCalled();
  });

  it("同じ棋譜なら書く", async () => {
    open("/ws/a.kif");
    await typeAndAutosave("A のメモ");

    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);
    expect(setCommentsByCursor.mock.calls[0][1]).toEqual(["A のメモ"]);
  });
});

/**
 * ノートは閉じる手続きを通らずに閉じたり移ったりする。
 * `KifuStreamList` は分岐メニュー・手のメニュー・棋譜の差し替えで
 * `setOpenComment(null)` を直に呼び、別の手のコメントボタンは
 * `open` を true のままカーソルだけ差し替える。
 *
 * どちらも 900ms のタイマーより早く踏めるので、出ていく面を書き切らないと
 * **書きかけの本文が黙って消える**。
 */
describe("面が入れ替わるとき", () => {
  const OTHER: CursorPath = {
    tesuu: 7,
    forkPointers: [],
  };

  function show(
    view: ReturnType<typeof open>,
    props: { open?: boolean; cursor?: CursorPath; absPath?: string | null; onClose?: () => void },
  ) {
    return act(async () => {
      view.rerender(
        <KifuCommentNote
          open={props.open ?? true}
          cursor={props.cursor ?? CURSOR}
          absPath={props.absPath ?? "/ws/a.kif"}
          anchorEl={null}
          onClose={props.onClose ?? (() => {})}
        />,
      );
    });
  }

  it("別の手のコメントへ移る前に、出ていく面へ書く", async () => {
    const view = open("/ws/a.kif");
    await type("5手目のメモ");

    await act(async () => {
      view.rerender(
        <KifuCommentNote
          open
          cursor={OTHER}
          absPath="/ws/a.kif"
          anchorEl={null}
          onClose={() => {}}
        />,
      );
    });

    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);
    // **出ていく面の cursor へ書く。** いまの cursor へ書くと 7手目に 5手目の本文が入る
    expect(setCommentsByCursor.mock.calls[0][0]).toBe(CURSOR);
    expect(setCommentsByCursor.mock.calls[0][1]).toEqual(["5手目のメモ"]);
  });

  it("閉じる手続きを通らずに閉じられても、出ていく面へ書く", async () => {
    const view = open("/ws/a.kif");
    await type("メモ");

    await act(async () => {
      view.rerender(
        <KifuCommentNote
          open={false}
          cursor={CURSOR}
          absPath="/ws/a.kif"
          anchorEl={null}
          onClose={() => {}}
        />,
      );
    });

    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);
    expect(setCommentsByCursor.mock.calls[0][1]).toEqual(["メモ"]);
  });

  // 面の入れ替えは書き切りを await せずに撃つので、返る頃には別の面が描かれている。
  // 突き合わせずに書き戻すと、**打っていない手のノートに失敗の箱が出る**。
  it("出ていく面の失敗を、移った先の面に出さない", async () => {
    setCommentsByCursor.mockResolvedValue(Err("boom-A"));
    const view = open("/ws/a.kif");
    await type("5手目のメモ");

    await show(view, { cursor: OTHER });

    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  // `saveError` は面をまたいで残りうる。それで判定すると、別の手の失敗を抱えている
  // だけで、この面の**初回**の失敗が2回目と判定されて一度も伝えずに閉じる。
  it("別の手の失敗が残っていても、この面の初回の失敗ではノートを閉じない", async () => {
    setCommentsByCursor.mockResolvedValue(Err("boom"));
    const onClose = vi.fn();
    const view = open("/ws/a.kif");
    await type("5手目のメモ");

    await show(view, { cursor: OTHER, onClose });
    await type("7手目のメモ");

    await act(async () => {
      screen.getByTestId("close").click();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * **止め続けない側も固定する。** 止め続けると、書き込めない場所に置いた棋譜では
   * ノートを閉じる手段が1つも無くなる（失敗を伝えるより悪い行き止まり）。
   * `ConfirmDialog` の同じ判断には「閉じる道は塞がない」が付いているのに、
   * こちらには付いていなかった。
   */
  it("同じ失敗が2回続いたら、ノートは閉じる", async () => {
    setCommentsByCursor.mockResolvedValue(Err("Permission denied (os error 13)"));
    const onClose = vi.fn();
    const view = open("/ws/a.kif");
    await show(view, { onClose });
    await type("メモ");

    await act(async () => {
      screen.getByTestId("close").click();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByTestId("close").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * 宛先が切り替わった枝は `setCommentsByCursor` を**呼ぶ前に**戻るので、
   * 本文はディスクにもメモリの棋譜にも入っていない。失敗と同じだけ失うのに
   * 1回で閉じると、理由を入れた赤い箱が1フレームも見えない。
   */
  it("宛先が切り替わっていても、初めての失敗ではノートを閉じない", async () => {
    const onClose = vi.fn();
    const view = open("/ws/a.kif");
    await show(view, { onClose });
    // 突き合わせは再レンダを跨いで拾うので、打つ前に切り替える
    gameState.loadedAbsPath = "/ws/b.kif";
    await type("メモ");

    await act(async () => {
      screen.getByTestId("close").click();
    });

    expect(setCommentsByCursor).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("棋譜が切り替わった");
  });

  // エディタを作り直す鍵と中身が別々の出どころだと1レンダずれ、
  // **移った先のエディタが前の手の本文で mount される**。
  // Lexical は初期値しか読まないので、そのまま最後まで残る。
  it("移った先のエディタを、前の手の本文で組まない", async () => {
    const view = open("/ws/a.kif");
    await type("5手目のメモ");

    await show(view, { cursor: OTHER });

    expect(mountedWith()).toBe("");
  });

  // 撃てないぶんを捨てると、利用者から見えるのは「保存済み」だけで、
  // 最後に打った本文はどこにも入っていない。
  it("保存中に来た自動保存を捨てず、前の保存が終わってから書く", async () => {
    let release: ((v: unknown) => void) | null = null;
    setCommentsByCursor.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(Ok(undefined)))),
    );

    open("/ws/a.kif");
    await typeAndAutosave("あ");
    expect(setCommentsByCursor).toHaveBeenCalledTimes(1);

    // 1本目が返らないうちに打ち足して、次の自動保存を撃つ
    setCommentsByCursor.mockResolvedValue(Ok(undefined));
    await typeAndAutosave("あい");

    await act(async () => {
      release?.(null);
    });

    const written = setCommentsByCursor.mock.calls.map((c) => c[1]);
    expect(written).toContainEqual(["あい"]);
  });
});

/**
 * `edit` は書き込みの**前**にメモリの棋譜を置き換える（ADR-0004 決定7）。
 * その最中に面を組み直すと、`baseText` に**まだディスクに無い本文**が入る。
 *
 * ここは `useGame` を板に差し替えているので、楽観的更新は `comments` を手で進めて表す。
 * 「`edit` が書き込みの前に置き換える」ことと「失敗したら巻き戻す」ことは
 * `entities/game` 側（`persistGuard.test.tsx` / `reducer.test.ts`）が固定している。
 */
describe("走っている保存の面を組み直したとき", () => {
  const OTHER: CursorPath = {
    tesuu: 7,
    forkPointers: [],
  };

  function show(
    view: ReturnType<typeof open>,
    props: { cursor?: CursorPath; open?: boolean } = {},
  ) {
    return act(async () => {
      view.rerender(
        <KifuCommentNote
          open={props.open ?? true}
          cursor={props.cursor ?? CURSOR}
          absPath="/ws/a.kif"
          anchorEl={null}
          onClose={() => {}}
        />,
      );
    });
  }

  /** 1本目だけ握って返さない。以降は即座に同じ失敗を返す */
  function holdFirstFailure(error: string) {
    let release!: () => void;
    const held = new Promise((r) => {
      release = () => r(Err(error));
    });
    setCommentsByCursor.mockImplementation(() =>
      setCommentsByCursor.mock.calls.length === 1 ? held : Promise.resolve(Err(error)),
    );
    return async () => {
      await act(async () => {
        release();
        await held;
      });
    };
  }

  /**
   * 失敗の書き戻しで基準も戻さないと `dirty` が落ちたままになり、
   * 閉じるときの再試行も「この面で初めての失敗なら閉じない」も**どちらも発火しない**。
   */
  it("走っている保存の面へ戻ってから失敗が返ったら、閉じるときにもう一度書きに行く", async () => {
    const fail = holdFirstFailure("boom");
    const view = open("/ws/a.kif");

    await typeAndAutosave("消えては困るメモ");
    comments = ["消えては困るメモ"];
    await show(view, { cursor: OTHER });
    await show(view, {});

    await fail();
    const before = setCommentsByCursor.mock.calls.length;

    await act(async () => {
      screen.getByTestId("close").click();
    });

    const calls = setCommentsByCursor.mock.calls;
    expect(calls.length).toBeGreaterThan(before);
    expect(calls[calls.length - 1][1]).toEqual(["消えては困るメモ"]);
  });
});
