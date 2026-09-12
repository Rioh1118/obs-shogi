// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { FsError } from "@/entities/file-tree";

/**
 * インポートは、失敗を出す場所を自分で持つ。
 *
 * provider の `failToCaller` は衝突以外を積まない。フォームが `result.error` を
 * 捨てると失敗がどこにも出ず、押しても何も起きない画面になる。
 *
 * 組んだ局面から作る側は `features/position-editor` の `createForm.test.tsx`。
 */

const createNewFile = vi.fn();
const importKifuFile = vi.fn();

// 差し替えるのは実体の側。barrel は再 export なので、こちらを差し替えれば通る
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    createNewFile,
    importKifuFile,
    fileTree: { id: "/root", name: "root", path: "/root", isDirectory: true, children: [] },
  }),
}));

const { default: KifuImportForm } = await import("../KifuImportForm");

const BAD_NAME: FsError = {
  code: "invalid_name_separator",
  message: "name contains a path separator",
  path: "/root",
};
const CONFLICT: FsError = {
  code: "already_exists",
  message: "destination already exists",
  path: "/root/a.kif",
};

// 解析を通る最小の kif。インポートの送信条件（解析 OK）を満たすために要る
const KIF_TEXT = "手数----指手---------消費時間--\n   1 ７六歩(77)   ( 0:00/00:00:00)\n";

const onCreated = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  createNewFile.mockReset();
  importKifuFile.mockReset();
  onCreated.mockReset();
  onCancel.mockReset();
});

afterEach(() => cleanup());

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("form is not rendered");
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe("KifuImportForm", () => {
  function fillImport() {
    typeInto("棋譜テキスト", KIF_TEXT);
    typeInto("ファイル名(必須)", "研究");
  }

  test("インポートに失敗したら理由が出る", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("名前に / や \\ は使えません")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  // 拡張子を落とすのは送るときだけ（`kifuFileName`）。打鍵のたびに落とすと、
  // `.kif` の `f` を打った瞬間に4文字消える
  test("拡張子まで打っても、打った文字は欄から消えない", () => {
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    typeInto("ファイル名(必須)", "45角戦法.kif");

    expect(screen.getByLabelText<HTMLInputElement>("ファイル名(必須)").value).toBe("45角戦法.kif");
  });

  test("打った拡張子は二重に付かない", async () => {
    importKifuFile.mockResolvedValue({ success: true, data: "/root/45角戦法.kif" });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    typeInto("棋譜テキスト", KIF_TEXT);
    typeInto("ファイル名(必須)", "45角戦法.kif");
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledWith("/root", "45角戦法.kif", expect.any(String));
  });

  test("衝突は別名を選ぶ対話が引き取るので、フォーム側では出さない", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("同じ名前のものが既にあります")).toBeNull();
  });
});
