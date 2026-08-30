// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Err, Ok } from "@/shared/lib/result";
import type { KifuCursor } from "@/entities/kifu/model/cursor";

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
// 見たいのは「何を、どこへ、いつ書くか」であって、エディタの中身ではない。
vi.mock("@/shared/ui/live-markdown-note/LiveMarkdownNote", () => ({
  default: ({ onMarkdownChange }: { onMarkdownChange?: (s: string) => void }) => (
    <textarea data-testid="editor" onChange={(e) => onMarkdownChange?.(e.target.value)} />
  ),
}));

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

const CURSOR: KifuCursor = {
  tesuu: 5,
  forkPointers: [],
  tesuuPointer: "5,[]" as KifuCursor["tesuuPointer"],
};

function open(absPath: string | null) {
  return render(
    <KifuCommentNote open cursor={CURSOR} absPath={absPath} anchorEl={null} onClose={() => {}} />,
  );
}

/** 900ms のデバウンスを待たずに autosave を撃つ */
async function typeAndAutosave(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByTestId("editor"), { target: { value: text } });
  });
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
