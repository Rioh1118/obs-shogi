// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";

import type { FileConflictState } from "@/features/file-conflict/model/types";

/**
 * 衝突を別名で解決したら、発端のモーダルも閉じる。
 *
 * 閉じないと、ファイルは作られたのに**入力がそのまま残ったフォーム**が下から
 * 出てくる。成功も失敗も出ていないので作られたことに気づけず、もう一度押すと
 * 同じ棋譜の2本目ができる。
 */

const closeModal = vi.fn();
const resolveConflictByRename = vi.fn();
// **原因を実際に消す。** `vi.fn()` のままだと、出口の `onClick` を空にしてもテストが通る
const closeConflict = vi.fn(() => {
  stub.conflict = null;
});
const clearKifuError = vi.fn(() => {
  stub.kifuError = null;
});
const stub = {
  conflict: null as FileConflictState | null,
  kifuError: null as { code: string; message: string } | null,
};

// 差し替えるのは実体の側。barrel は再 export なので describeFsError は本物が通る
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    conflict: stub.conflict,
    kifuError: stub.kifuError,
    closeConflict,
    resolveConflictByRename,
    clearKifuError,
  }),
}));

vi.mock("@/shared/lib/router/useURLParams", () => ({
  useURLParams: () => ({ closeModal, openModal: vi.fn(), updateParams: vi.fn(), params: {} }),
}));

// 対話そのものの中身は FileConflictDialog.test.tsx が見る。ここは繋ぎだけ
const noModal = { default: () => null };
for (const path of [
  "@/features/create-file/ui/CreateFileModal",
  "@/features/create-file/ui/SfenKifuCreateModal",
  "@/features/position-navigation/ui/PositionNavigationModal",
  "@/features/position-search/ui/PositionSearchModal",
  "@/features/study-position-save/ui/StudyPositionSaveModal",
  "@/features/study-positions-manager/ui/StudyPositionsManagerModal",
]) {
  vi.doMock(path, () => noModal);
}

/** 1枚だけ落とせるようにする。どの1枚でもよいので、いちばん素の設定モーダルを使う */
const throwing = { settings: false };
vi.doMock("@/features/settings/ui/SettingsModal", () => ({
  default: () => {
    if (throwing.settings) throw new Error("設定モーダルの中で落ちた");
    return null;
  },
}));
vi.mock("@/features/kifu-read-error", () => ({ KifuReadErrorDialog: () => null }));
vi.mock("@/shared/ui/Modal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: AppModalLayer } = await import("../AppModalLayer");

function conflictFor(kind: "create_file" | "rename_file"): FileConflictState {
  const error = { code: "already_exists" as const, message: "destination already exists" };
  return kind === "create_file"
    ? {
        request: {
          kind,
          parentPath: "/root",
          options: {
            fileName: "a.kif",
            format: "kif",
            gameInfo: {},
            initialPosition: { preset: "HIRATE" },
          },
        },
        error,
      }
    : { request: { kind, path: "/root/a.kif", newName: "b.kif" }, error };
}

beforeEach(() => {
  // **可変の模擬状態は1箇所で戻す。** `stub.conflict` は境界の `resetKeys` に入る値そのもので、
  // 持ち越すと「いま検証している機構の入力」を前のテストが決めることになる
  stub.conflict = null;
  stub.kifuError = null;
  throwing.settings = false;
  closeConflict.mockClear();
  clearKifuError.mockClear();
  closeModal.mockReset();
  resolveConflictByRename.mockReset().mockResolvedValue({ success: true, data: undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function resolveWith(name: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

describe("衝突の解決", () => {
  test("モーダルから起こした衝突なら、解決後にそのモーダルも閉じる", async () => {
    stub.conflict = conflictFor("create_file");
    render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    await resolveWith("b.kif");

    expect(resolveConflictByRename).toHaveBeenCalledWith("b.kif");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("ツリーから起こした衝突では、閉じる相手がいないので閉じない", async () => {
    stub.conflict = conflictFor("rename_file");
    render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    await resolveWith("c.kif");

    expect(closeModal).not.toHaveBeenCalled();
  });

  test("解決に失敗したら閉じない。フォームに戻って直せる必要がある", async () => {
    stub.conflict = conflictFor("create_file");
    resolveConflictByRename.mockResolvedValue({
      success: false,
      error: { code: "permission_denied", message: "denied" },
    });
    render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    await resolveWith("b.kif");

    expect(closeModal).not.toHaveBeenCalled();
  });
});

/**
 * 層が落ちたときに、何を畳み・何で解けるか。
 *
 * この層は平常時 in-flow の子を1つも作らない（閉じている間は `null`、開くと portal）。
 * `.app-layout` は `grid-template-rows` が2段なので、**箱を作る fallback を出すと
 * 本体が暗黙の3段目へ押し出されて `overflow: hidden` に切られる。**
 *
 * 鍵は `location.key` と、URL を持たない2枚の入力。**`params.modal` で数え上げない** ——
 * この層は `tab` / `dir` / `sfen` / `returnTo` も読むので、名前で並べると足し忘れる。
 */
describe("モーダル層の境界", () => {
  test("落ちても箱を作らない", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;

    const { container } = render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    const fallback = container.querySelector(".app-error-fallback");
    expect(fallback).not.toBeNull();
    expect(
      fallback!.classList.contains("app-error-fallback--floating"),
      "in-flow の箱を出すと `.app-layout` の1段目を取り、本体が3段目へ押し出される",
    ).toBe(true);
    expect(screen.getByText("モーダルを表示できませんでした。")).toBeTruthy();
  });

  test("行き先が変わったら、境界も畳むのをやめる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;

    function GoElsewhere() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/other")}>
          移動
        </button>
      );
    }

    render(
      <MemoryRouter>
        <GoElsewhere />
        <AppModalLayer />
      </MemoryRouter>,
    );
    expect(screen.getByText("モーダルを表示できませんでした。")).toBeTruthy();

    // 原因は消しておく。**鍵から `location.key` を落とすと、ここで解けない**
    throwing.settings = false;
    fireEvent.click(screen.getByText("移動"));

    expect(screen.queryByText("モーダルを表示できませんでした。")).toBeNull();
  });

  test("待っている操作が原因なら、それを取り消す出口を出して結果を知らせる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.conflict = conflictFor("create_file");

    render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    // 「別の操作からやり直す」だけだと、解けた瞬間に同じ値を描いてまた落ちる。
    // **畳みが解けるかは原因による**ので、ここで見るのは「原因を消したこと」と
    // 「捨てたものを知らせたこと」の2つ（解けることは `kifuError` の1本が見る）
    fireEvent.click(screen.getByText("待っている操作を取り消す"));

    expect(closeConflict).toHaveBeenCalled();
    // **捨てたものを知らせる。** 衝突は待っているファイル操作そのもので、
    // 押した人は送信ボタンを押した後なので、作られたかどうかの手掛かりが要る
    expect(screen.getByText(/待っていた操作を取り消しました/)).toBeTruthy();
  });

  test("知らせるだけの失敗なら、綴りも軽い", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.kifuError = { code: "unreadable", message: "読めない" };

    render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    // 捨てるのが説明だけなら「取り消す」と言わない
    expect(screen.getByText("知らせを閉じる")).toBeTruthy();
  });

  test("`kifuError` が消えたら、境界も畳むのをやめる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.kifuError = { code: "unreadable", message: "読めない" };

    const { rerender } = render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );
    expect(screen.getByText("モーダルを表示できませんでした。")).toBeTruthy();

    throwing.settings = false;
    stub.kifuError = null;
    rerender(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    expect(screen.queryByText("モーダルを表示できませんでした。")).toBeNull();
  });

  test("URL を持たない衝突が消えたら、境界も畳むのをやめる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.conflict = conflictFor("create_file");

    const { rerender } = render(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );
    expect(screen.getByText("モーダルを表示できませんでした。")).toBeTruthy();

    // 原因が消え、URL は1文字も動いていない。鍵が `location` だけなら解けない
    throwing.settings = false;
    stub.conflict = null;
    rerender(
      <MemoryRouter>
        <AppModalLayer />
      </MemoryRouter>,
    );

    expect(screen.queryByText("モーダルを表示できませんでした。")).toBeNull();
  });
});
