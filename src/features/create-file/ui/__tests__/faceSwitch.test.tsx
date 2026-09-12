// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";

/**
 * タブを跨いだときに何が残り、何が消えるか（状態遷移表の I×X9 と W×X9）。
 *
 * **器そのものを描く。** 面だけを描くと、面を外すのが器の側の判断なので、
 * 「タブへ移ったら組みかけが消える」がテストに現れない。
 * 面の中で閉じた話は `features/position-editor` の側が見る。
 */

const closeModal = vi.fn();
const params: { modal?: string; dir?: string; tab?: string } = { modal: "create-file" };

vi.mock("@/shared/lib/router/useURLParams", () => ({
  useURLParams: () => ({ params, closeModal }),
}));

vi.mock("@/entities/study-positions/model/useStudyPositions", () => ({
  useStudyPositions: () => ({ state: { positions: [] } }),
}));

const createNewFile = vi.fn();
const importKifuFile = vi.fn();
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    createNewFile,
    importKifuFile,
    fileTree: { id: "/root", name: "root", path: "/root", isDirectory: true, children: [] },
  }),
}));

const { default: CreateFileModal } = await import("../CreateFileModal");

beforeEach(() => {
  params.modal = "create-file";
  params.tab = undefined;
  closeModal.mockReset();
  createNewFile.mockReset();
  createNewFile.mockResolvedValue({ success: true });
  importKifuFile.mockReset();
  importKifuFile.mockResolvedValue({ success: true });
});
afterEach(cleanup);

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const hasPiece = (x: number, y: number): boolean => square(x, y).querySelector(".piece") !== null;

const tab = (name: string) => screen.getByRole("tab", { name, hidden: true });

/**
 * 面ごとに引く
 *
 * **両方の面が木に残る**（外すと組みかけも貼りかけも消える）ので、
 * 同じ語のラベルもボタンも器の中に2つある。器ごと引くと、
 * 隠れているほうを掴んで「押しても何も起きない」テストになる。
 */
const faceIn = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`面が無い: ${selector}`);
  return within(el);
};
const importFace = () => faceIn(".create-file-modal__narrow");
const boardFace = () => faceIn(".pos-editor");

/** 7七の歩を7六へ動かして、組みかけにする */
function makeDirty() {
  fireEvent.click(square(7, 7));
  fireEvent.click(square(7, 6));
  expect(hasPiece(7, 6)).toBe(true);
  expect(hasPiece(7, 7)).toBe(false);
}

describe("タブの切り替え（X9）", () => {
  test("インポートへ移って戻っても、組んだものは残る", () => {
    render(<CreateFileModal />);
    makeDirty();

    fireEvent.click(tab("インポート"));
    fireEvent.click(tab("新規作成"));

    expect(hasPiece(7, 6)).toBe(true);
    expect(hasPiece(7, 7)).toBe(false);
  });

  test("インポートへ移ると掴んでいる駒は離れる", () => {
    render(<CreateFileModal />);
    fireEvent.click(square(7, 7));
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(true);

    fireEvent.click(tab("インポート"));
    fireEvent.click(tab("新規作成"));

    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(false);
  });

  test("課題局面の面を出したままタブを往復しても、戻り先は盤", () => {
    render(<CreateFileModal />);
    // 隠れているあいだにどちらの面を描くかは目に見えないが、**フォームの有無が変わる**。
    // 課題局面の面を描くと、隠れているあいだに作成フォームごと外れて入力が消える
    fireEvent.change(boardFace().getByLabelText("ファイル名"), { target: { value: "45角戦法" } });
    fireEvent.click(screen.getByRole("button", { name: "課題局面から…" }));
    expect(screen.getByRole("button", { name: "戻る" })).toBeTruthy();

    fireEvent.click(tab("インポート"));
    fireEvent.click(tab("新規作成"));

    expect(screen.queryByRole("button", { name: "戻る" })).toBeNull();
    expect(hasPiece(7, 7)).toBe(true);
    expect(boardFace().getByLabelText<HTMLInputElement>("ファイル名").value).toBe("45角戦法");
  });

  test("閉じて開き直すと、面は盤から始まる", () => {
    const { rerender } = render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));

    params.modal = undefined;
    rerender(<CreateFileModal />);
    params.modal = "create-file";
    rerender(<CreateFileModal />);

    expect(tab("新規作成").getAttribute("aria-selected")).toBe("true");
  });
});

/** 読める最小の kif。インポートの送信条件（棋譜として読めたこと）を満たすために要る */
const KIF_TEXT = "手数----指手---------消費時間--\n   1 ７六歩(77)   ( 0:00/00:00:00)\n";

/** インポートの面を出して、送信できるところまで埋める */
function fillImport() {
  fireEvent.click(tab("インポート"));
  fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });
  fireEvent.change(importFace().getByLabelText("ファイル名"), { target: { value: "研究" } });
}

const importForm = (): HTMLFormElement => {
  const form = document.querySelector<HTMLFormElement>(".create-file-modal__narrow form");
  if (!form) throw new Error("インポートのフォームが無い");
  return form;
};

describe("インポートの面から閉じる", () => {
  test("組みかけを持ったまま「やめる」を押すと確認が出る", () => {
    render(<CreateFileModal />);
    makeDirty();
    fireEvent.click(tab("インポート"));

    fireEvent.click(importFace().getByRole("button", { name: "やめる" }));

    expect(screen.getByText("組んだ局面は保存されません。")).toBeTruthy();
    expect(closeModal).not.toHaveBeenCalled();
  });

  test("組みかけが無ければ、そのまま閉じる", () => {
    render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));

    fireEvent.click(importFace().getByRole("button", { name: "やめる" }));

    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("インポートの面へ移ると、貼り付け欄に焦点が入る", async () => {
    // 焦点は次のフレームで移す。**器の `Modal` が開いた直後に引き戻すので、
    // 同じターンで移すと奪われる**
    const frame = () =>
      act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    render(<CreateFileModal />);
    await frame();
    // **隠れているあいだに移してはいけない。** 実ブラウザでは `display: none` への
    // `focus()` は何も起きず、そのあとタブで出てきても焦点を動かす口が無い
    expect(document.activeElement?.id).not.toBe("rawKifu");

    fireEvent.click(tab("インポート"));
    await frame();
    expect(document.activeElement?.id).toBe("rawKifu");
  });
});

describe("作成中（W）", () => {
  test("作成が返るまでタブは押せない", async () => {
    let finish: (result: { success: boolean }) => void = () => undefined;
    createNewFile.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        finish = resolve;
      }),
    );

    render(<CreateFileModal />);
    fireEvent.change(boardFace().getByLabelText("ファイル名"), { target: { value: "a" } });
    // **組む面の中から探す。** インポートの面も木に残っていて、そちらの
    // フォームのほうが DOM では先に来る
    const form = document.querySelector(".pos-editor form");
    if (!form) throw new Error("フォームが無い");
    await act(async () => {
      fireEvent.submit(form);
    });

    expect((tab("インポート") as HTMLButtonElement).disabled).toBe(true);
    // 盤も受け付けない。受け付けると、組んだものと送ったものが食い違う
    expect(document.querySelector(".pos-editor__main")?.hasAttribute("inert")).toBe(true);

    await act(async () => {
      finish({ success: true });
    });
    expect((tab("インポート") as HTMLButtonElement).disabled).toBe(false);
  });

  test("インポートの側で送信中も、タブが沈み Esc で閉じない", async () => {
    // **旗は面ごとに立つ。** 片方しか見ないと、見ていない面で送信中に器が閉じ、
    // 失敗を出す場所ごと消える
    let finish: (result: { success: boolean }) => void = () => undefined;
    importKifuFile.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        finish = resolve;
      }),
    );

    render(<CreateFileModal />);
    fillImport();
    await act(async () => {
      fireEvent.submit(importForm());
    });

    expect((tab("新規作成") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeModal).not.toHaveBeenCalled();

    await act(async () => {
      finish({ success: true });
    });
  });

  test("保存先はツリーの根に倒れる（`dir=` が来ない入口がある）", async () => {
    render(<CreateFileModal />);
    fillImport();
    await act(async () => {
      fireEvent.submit(importForm());
    });

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(importKifuFile.mock.calls[0]?.[0]).toBe("/root");
  });
});
