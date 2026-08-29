// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { FsError } from "@/entities/file-tree";

/**
 * 作成とインポートは、失敗を出す場所を自分で持つ。
 *
 * provider の `deferFailure` は衝突以外を積まない。フォームが `result.error` を
 * 捨てると失敗がどこにも出ず、押しても何も起きない画面になる。
 */

const createNewFile = vi.fn();
const importKifuFile = vi.fn();

// 差し替えるのは実体の側。barrel は再 export なので、こちらを差し替えれば通る
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile, importKifuFile }),
}));

const { default: FileCreateForm } = await import("../FileCreateForm");
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

const toggleModal = vi.fn();

beforeEach(() => {
  createNewFile.mockReset();
  importKifuFile.mockReset();
  toggleModal.mockReset();
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

describe("FileCreateForm", () => {
  test("作成に失敗したら理由が出る", async () => {
    createNewFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<FileCreateForm toggleModal={toggleModal} dirPath="/root" />);

    typeInto("ファイル名", "研究/2026");
    await submitForm();

    expect(screen.getByText("名前に / や \\ は使えません")).toBeTruthy();
    expect(toggleModal).not.toHaveBeenCalled();
  });

  test("失敗しても入力は残り、直してそのまま押し直せる", async () => {
    createNewFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<FileCreateForm toggleModal={toggleModal} dirPath="/root" />);

    typeInto("ファイル名", "研究/2026");
    await submitForm();

    expect((screen.getByLabelText("ファイル名") as HTMLInputElement).value).toBe("研究/2026");

    createNewFile.mockResolvedValue({ success: true, data: undefined });
    typeInto("ファイル名", "研究2026");
    await submitForm();

    expect(toggleModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("名前に / や \\ は使えません")).toBeNull();
  });

  test("衝突は別名を選ぶ対話が引き取るので、フォーム側では出さない", async () => {
    createNewFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<FileCreateForm toggleModal={toggleModal} dirPath="/root" />);

    typeInto("ファイル名", "a");
    await submitForm();

    expect(screen.queryByText("同じ名前のものが既にあります")).toBeNull();
  });
});

describe("KifuImportForm", () => {
  function fillImport() {
    typeInto("棋譜テキスト", KIF_TEXT);
    typeInto("ファイル名(必須)", "研究");
  }

  test("インポートに失敗したら理由が出る", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<KifuImportForm toggleModal={toggleModal} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("名前に / や \\ は使えません")).toBeTruthy();
    expect(toggleModal).not.toHaveBeenCalled();
  });

  test("衝突は別名を選ぶ対話が引き取るので、フォーム側では出さない", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<KifuImportForm toggleModal={toggleModal} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("同じ名前のものが既にあります")).toBeNull();
  });
});
