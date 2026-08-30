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

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: gameState,
    getCommentsByCursor: () => [],
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
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
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

  // 固定しているのは「失敗しても下書きを元に戻さない」ところまで。
  // 「dirty が落ちない」ことは、この経路（書き足して再度 autosave）では
  // どちらでも緑になるので**このテストでは押さえていない**。
  // 落ちないことは1件目（失敗のあと「保存済み」を出さない）が押さえる。
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
