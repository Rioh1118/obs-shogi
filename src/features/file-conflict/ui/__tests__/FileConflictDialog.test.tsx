// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { FileConflictState } from "@/features/file-conflict/model/types";
import FileConflictDialog from "../FileConflictDialog";

/**
 * 別名でもう一度衝突したときが、この対話が存在する理由そのもの。
 *
 * provider は衝突のたびに新しい `conflict` オブジェクトを作るので、
 * オブジェクトの同一性で入力を初期化すると、置いた直後の失敗の理由が消え、
 * 入力も要求名へ戻って `canSubmit` が false になる。
 * **押せず、理由も出ない状態**で止まる。
 */

vi.mock("@/shared/ui/Modal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function conflictFor(fileName: string): FileConflictState {
  return {
    request: {
      kind: "create_file",
      parentPath: "/root",
      options: { fileName, format: "kif", gameInfo: {}, initialPosition: { preset: "HIRATE" } },
    },
    error: {
      code: "already_exists",
      message: "destination already exists",
      path: `/root/${fileName}`,
    },
  };
}

afterEach(() => cleanup());

describe("FileConflictDialog", () => {
  test("別名でもう一度衝突したら、理由を出して入力を残す", async () => {
    const onSubmitRename = vi.fn().mockResolvedValue({
      success: false,
      error: conflictFor("b.kif").error,
    });

    const { rerender } = render(
      <FileConflictDialog
        conflict={conflictFor("a.kif")}
        onCancel={vi.fn()}
        onSubmitRename={onSubmitRename}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "b.kif" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });

    // provider は新しい conflict を積む。同じ対話の続きなので入力は初期化しない
    rerender(
      <FileConflictDialog
        conflict={conflictFor("b.kif")}
        onCancel={vi.fn()}
        onSubmitRename={onSubmitRename}
      />,
    );

    expect(onSubmitRename).toHaveBeenCalledWith("b.kif");
    expect(screen.getByRole("alert").textContent).toBe("同じ名前のものが既にあります");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("b.kif");
  });

  test("別の操作の衝突で開き直したら、入力はその要求名から始まる", () => {
    const { rerender } = render(
      <FileConflictDialog
        conflict={conflictFor("a.kif")}
        onCancel={vi.fn()}
        onSubmitRename={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "打ちかけ" } });

    const other: FileConflictState = {
      ...conflictFor("c.kif"),
      request: {
        kind: "create_file",
        parentPath: "/root/研究",
        options: {
          fileName: "c.kif",
          format: "kif",
          gameInfo: {},
          initialPosition: { preset: "HIRATE" },
        },
      },
    };
    rerender(<FileConflictDialog conflict={other} onCancel={vi.fn()} onSubmitRename={vi.fn()} />);

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("c.kif");
  });
});
