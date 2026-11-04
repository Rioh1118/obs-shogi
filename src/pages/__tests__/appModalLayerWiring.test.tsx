// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { FileConflictState } from "@/features/file-conflict/model/types";

/**
 * URL を持たない2枚の対話へ渡す閉じ方と、層が畳まれている間の案内と出口。
 *
 * 対話へ渡す関数を取り違えても型は通る。閉じても `conflict` と `kifuError` が残り、
 * 同じ対話がまた出る。案内は、立っている知らせが原因のときだけ
 * 「捨ててから再表示」を言う。逆に言うと、原因でないときに捨てさせるか、
 * 原因のときに再表示だけを勧めて同じ所で落ち続ける。
 */

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

vi.mock("@/entities/file-tree/model/useFileTree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/file-tree/model/useFileTree")>();
  const mocked = {
    ...actual,
    useFileTree: (() => ({
      conflict: stub.conflict,
      kifuError: stub.kifuError,
      closeConflict,
      resolveConflictByRename: vi.fn(),
      clearKifuError,
    })) as unknown as typeof actual.useFileTree,
  };
  return mocked satisfies typeof import("@/entities/file-tree/model/useFileTree");
});
vi.mock("@/shared/lib/router/useURLParams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/router/useURLParams")>();
  const mocked = {
    ...actual,
    useURLParams: (() => ({
      closeModal: vi.fn(),
      openModal: vi.fn(),
      updateParams: vi.fn(),
      params: {},
    })) as unknown as typeof actual.useURLParams,
  };
  return mocked satisfies typeof import("@/shared/lib/router/useURLParams");
});

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

const throwing = { settings: false };
vi.doMock("@/features/settings/ui/SettingsModal", () => ({
  default: () => {
    if (throwing.settings) throw new Error("設定モーダルの中で落ちた");
    return null;
  },
}));

/** 対話が最後に受け取った閉じ方 */
const dialogs = {
  onCancel: null as null | (() => void),
  onDismiss: null as null | (() => void),
};
vi.mock("@/features/file-conflict/ui/FileConflictDialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/file-conflict/ui/FileConflictDialog")>();
  const mocked = {
    ...actual,
    default: (({ onCancel }: { onCancel: () => void }) => {
      dialogs.onCancel = onCancel;
      return null;
    }) as unknown as typeof actual.default,
  };
  return mocked satisfies typeof import("@/features/file-conflict/ui/FileConflictDialog");
});
vi.mock("@/features/kifu-read-error", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/kifu-read-error")>();
  const mocked = {
    ...actual,
    KifuReadErrorDialog: (({ onDismiss }: { onDismiss: () => void }) => {
      dialogs.onDismiss = onDismiss;
      return null;
    }) as unknown as typeof actual.KifuReadErrorDialog,
  };
  return mocked satisfies typeof import("@/features/kifu-read-error");
});

const { default: AppModalLayer } = await import("../AppModalLayer");

function mount() {
  return render(
    <MemoryRouter>
      <AppModalLayer />
    </MemoryRouter>,
  );
}

const conflict: FileConflictState = {
  request: { kind: "rename_file", path: "/root/a.kif", newName: "b.kif" },
  error: { code: "already_exists", message: "destination already exists" },
};

beforeEach(() => {
  stub.conflict = null;
  stub.kifuError = null;
  throwing.settings = false;
  dialogs.onCancel = null;
  dialogs.onDismiss = null;
  closeConflict.mockClear();
  clearKifuError.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("URL を持たない対話の閉じ方", () => {
  test("衝突の対話を閉じると、待っている衝突を閉じる", () => {
    stub.conflict = conflict;
    mount();

    dialogs.onCancel!();

    expect(closeConflict).toHaveBeenCalledTimes(1);
  });

  test("読めなかった知らせを閉じると、その知らせを消す", () => {
    stub.kifuError = { code: "unreadable", message: "読めない" };
    mount();

    dialogs.onDismiss!();

    expect(clearKifuError).toHaveBeenCalledTimes(1);
  });
});

describe("層が畳まれている間の案内", () => {
  test("知らせが立っていなければ、別の操作からやり直すよう言う", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    mount();

    expect(screen.getByText("別の操作からやり直してから「再表示」を押してください。")).toBeTruthy();
    expect(screen.queryByText("知らせを閉じる")).toBeNull();
  });

  test("知らせが立っていれば、捨ててから再表示するよう言う", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.kifuError = { code: "unreadable", message: "読めない" };
    mount();

    expect(
      screen.getByText(
        "出しかけの知らせが原因のことがあります。「知らせを閉じる」を押してから「再表示」を押してください。",
      ),
    ).toBeTruthy();
  });

  test("知らせを閉じる出口は、読めなかった知らせも消し、閉じたことを知らせる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.settings = true;
    stub.kifuError = { code: "unreadable", message: "読めない" };
    mount();

    fireEvent.click(screen.getByText("知らせを閉じる"));

    expect(clearKifuError).toHaveBeenCalledTimes(1);
    expect(screen.getByText("知らせを閉じました。")).toBeTruthy();
  });
});
