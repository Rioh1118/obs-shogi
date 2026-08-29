// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
const stub = { conflict: null as FileConflictState | null };

// 差し替えるのは実体の側。barrel は再 export なので describeFsError は本物が通る
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    conflict: stub.conflict,
    kifuError: null,
    closeConflict: vi.fn(),
    resolveConflictByRename,
    clearKifuError: vi.fn(),
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
  "@/features/settings/ui/SettingsModal",
  "@/features/position-search/ui/PositionSearchModal",
  "@/features/study-position-save/ui/StudyPositionSaveModal",
  "@/features/study-positions-manager/ui/StudyPositionsManagerModal",
]) {
  vi.doMock(path, () => noModal);
}
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
  closeModal.mockReset();
  resolveConflictByRename.mockReset().mockResolvedValue({ success: true, data: undefined });
});

afterEach(() => cleanup());

async function resolveWith(name: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

describe("衝突の解決", () => {
  test("モーダルから起こした衝突なら、解決後にそのモーダルも閉じる", async () => {
    stub.conflict = conflictFor("create_file");
    render(<AppModalLayer />);

    await resolveWith("b.kif");

    expect(resolveConflictByRename).toHaveBeenCalledWith("b.kif");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("ツリーから起こした衝突では、閉じる相手がいないので閉じない", async () => {
    stub.conflict = conflictFor("rename_file");
    render(<AppModalLayer />);

    await resolveWith("c.kif");

    expect(closeModal).not.toHaveBeenCalled();
  });

  test("解決に失敗したら閉じない。フォームに戻って直せる必要がある", async () => {
    stub.conflict = conflictFor("create_file");
    resolveConflictByRename.mockResolvedValue({
      success: false,
      error: { code: "permission_denied", message: "denied" },
    });
    render(<AppModalLayer />);

    await resolveWith("b.kif");

    expect(closeModal).not.toHaveBeenCalled();
  });
});
