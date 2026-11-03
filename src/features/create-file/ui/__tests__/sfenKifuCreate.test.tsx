// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { FileTreeNode, FsError } from "@/entities/file-tree";

/**
 * 課題局面から棋譜を作る対話（仕様書の「課題局面から作成」）。
 *
 * `AppModalLayer` が常にマウントしているので、開くたびにフォームが初期化されることと、
 * 失敗を出す場所をこの対話が持つことを見る。
 */

const closeModal = vi.fn();
const params: { modal?: string; sfen?: string } = {};

vi.mock(
  "@/shared/lib/router/useURLParams",
  () =>
    ({
      useURLParams: () =>
        ({ params, closeModal }) as unknown as ReturnType<
          typeof import("@/shared/lib/router/useURLParams").useURLParams
        >,
    }) satisfies typeof import("@/shared/lib/router/useURLParams"),
);

const createNewFile = vi.fn();

const dir = (name: string, path: string, children: FileTreeNode[] = []): FileTreeNode =>
  ({
    name,
    path,
    isDirectory: true,
    children,
    displayInfo: { iconType: "folder" },
  }) as FileTreeNode;

let fileTree: FileTreeNode | null = dir("root", "/root");

vi.mock("@/entities/file-tree/model/useFileTree", () => {
  const mocked = {
    useFileTree: () =>
      ({ createNewFile, fileTree }) as unknown as ReturnType<
        typeof import("@/entities/file-tree/model/useFileTree").useFileTree
      >,
  };
  return mocked satisfies typeof import("@/entities/file-tree/model/useFileTree");
});

const { default: SfenKifuCreateModal } = await import("../SfenKifuCreateModal");

const SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

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

beforeEach(() => {
  params.modal = "sfen-kifu-create";
  params.sfen = SFEN;
  closeModal.mockReset();
  createNewFile.mockReset();
  fileTree = dir("root", "/root", [dir("角換わり", "/root/角換わり")]);
});

afterEach(cleanup);

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

/** 保存先の欄は `Select`（ボタンと一覧）なので、押して選ぶ */
function chooseDir(label: string) {
  fireEvent.click(screen.getByLabelText("保存先フォルダ"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

const createButton = () => screen.getByRole<HTMLButtonElement>("button", { name: /作成/ });

describe("SfenKifuCreateModal", () => {
  test("開いていなければ何も描かない", () => {
    params.modal = undefined;
    render(<SfenKifuCreateModal />);

    expect(document.querySelector(".sfen-kifu-create")).toBeNull();
  });

  test("局面が無ければ何も描かない", () => {
    params.sfen = undefined;
    render(<SfenKifuCreateModal />);

    expect(document.querySelector(".sfen-kifu-create")).toBeNull();
  });

  test("局面を OTHER として、選んだ保存先へ作り、作れたら閉じる", async () => {
    createNewFile.mockResolvedValue({ success: true, data: "/root/角換わり/研究.kif" });
    render(<SfenKifuCreateModal />);

    expect(screen.getByLabelText("保存先フォルダ").textContent).toBe("/");
    chooseDir("/角換わり");
    typeInto("ファイル名", "研究.kif");
    typeInto("先手名", " 先手 ");
    await submitForm();

    expect(createNewFile).toHaveBeenCalledTimes(1);
    const [parent, options] = createNewFile.mock.calls[0];
    expect(parent).toBe("/root/角換わり");
    expect(options.fileName).toBe("研究.kif");
    expect(options.format).toBe("kif");
    expect(options.gameInfo).toEqual({ black: "先手", white: undefined });
    expect(options.initialPosition.preset).toBe("OTHER");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("作成に失敗したら理由を出し、保存先を選び直すと消す", async () => {
    createNewFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<SfenKifuCreateModal />);

    typeInto("ファイル名", "研究");
    await submitForm();

    expect(screen.getByText("名前に / や \\ は使えません")).toBeTruthy();
    expect(closeModal).not.toHaveBeenCalled();

    chooseDir("/角換わり");
    expect(screen.queryByText("名前に / や \\ は使えません")).toBeNull();
  });

  test("衝突は別名を選ぶ対話が引き取るので、ここでは出さない", async () => {
    createNewFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<SfenKifuCreateModal />);

    typeInto("ファイル名", "研究");
    await submitForm();

    expect(screen.queryByText("同じ名前のものが既にあります")).toBeNull();
  });

  test("返事を待つあいだにもう一度押しても、2本は作らない", async () => {
    let resolve: (value: unknown) => void = () => {};
    createNewFile.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SfenKifuCreateModal />);

    typeInto("ファイル名", "研究");
    await submitForm();
    await submitForm();

    expect(createNewFile).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ success: true, data: "/root/研究.kif" }));
  });

  test("ツリーが無ければ、理由を出して作成を押せない", () => {
    fileTree = null;
    render(<SfenKifuCreateModal />);

    typeInto("ファイル名", "研究");

    expect(screen.getByText("保存先がありません。先にワークスペースを開いてください")).toBeTruthy();
    expect(createButton().disabled).toBe(true);
  });

  test("閉じて開き直すと、打った名前も選んだ保存先も消える", () => {
    const view = render(<SfenKifuCreateModal />);
    typeInto("ファイル名", "研究");
    typeInto("先手名", "先手");
    chooseDir("/角換わり");

    params.modal = undefined;
    view.rerender(<SfenKifuCreateModal />);
    params.modal = "sfen-kifu-create";
    view.rerender(<SfenKifuCreateModal />);

    expect(screen.getByLabelText<HTMLInputElement>("ファイル名").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("先手名").value).toBe("");
    expect(screen.getByLabelText("保存先フォルダ").textContent).toBe("/");
  });

  test("開いているあいだにツリーの根が替わったら、保存先を新しい根へ戻す", () => {
    const view = render(<SfenKifuCreateModal />);
    chooseDir("/角換わり");
    typeInto("ファイル名", "研究");

    fileTree = dir("other", "/other");
    view.rerender(<SfenKifuCreateModal />);

    expect(screen.getByLabelText("保存先フォルダ").textContent).toBe("/");
    // 根が替わっても、打った名前は残る
    expect(screen.getByLabelText<HTMLInputElement>("ファイル名").value).toBe("研究");
  });

  /**
   * 状態遷移表の X14 と同じ筋。`Select` は選択肢に無い値をプレースホルダで描くので、
   * 値だけ残すと、欄が「選択してください」と言っているのに消えたパスへ書きに行く。
   */
  test("選んでいた保存先が消えたら、根へ戻す", async () => {
    createNewFile.mockResolvedValue({ success: true, data: "/root/研究.kif" });
    const view = render(<SfenKifuCreateModal />);
    chooseDir("/角換わり");

    fileTree = dir("root", "/root");
    view.rerender(<SfenKifuCreateModal />);
    typeInto("ファイル名", "研究");
    await submitForm();

    expect(createNewFile.mock.calls[0]![0]).toBe("/root");
  });
});
