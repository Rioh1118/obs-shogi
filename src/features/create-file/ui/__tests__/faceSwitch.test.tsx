// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";

/**
 * タブを跨いだときに何が残り、何が消えるか（状態遷移表の I×X9 と W×X9）。
 *
 * **モーダルそのものを描く。** タブだけを描くと、タブを外すのがモーダルの側の判断なので、
 * 「タブへ移ったら組みかけが消える」がテストに現れない。
 * タブの中で閉じた話は `features/position-editor` の側が見る。
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
 * タブごとに引く
 *
 * **両方のタブが木に残る**（外すと組みかけも貼りかけも消える）ので、
 * 同じ語のラベルもボタンもモーダルの中に2つある。モーダルごと引くと、
 * 隠れているほうを掴んで「押しても何も起きない」テストになる。
 */
const faceIn = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`タブが無い: ${selector}`);
  return within(el);
};
const importFace = () => faceIn(".kifu-import");
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
    fireEvent.click(tab("作成"));

    expect(hasPiece(7, 6)).toBe(true);
    expect(hasPiece(7, 7)).toBe(false);
  });

  test("インポートへ移ると掴んでいる駒は離れる", () => {
    render(<CreateFileModal />);
    fireEvent.click(square(7, 7));
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(true);

    fireEvent.click(tab("インポート"));
    fireEvent.click(tab("作成"));

    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(false);
  });

  test("課題局面のパネルを出したままタブを往復しても、戻り先は盤", () => {
    render(<CreateFileModal />);
    // 隠れているあいだにどちらのパネルを描くかは目に見えないが、**フォームの有無が変わる**。
    // 課題局面のパネルを描くと、隠れているあいだに作成フォームごと外れて入力が消える
    fireEvent.change(boardFace().getByLabelText("ファイル名"), { target: { value: "45角戦法" } });
    fireEvent.click(screen.getByRole("button", { name: "課題局面から…" }));
    expect(screen.getByRole("button", { name: "戻る" })).toBeTruthy();

    fireEvent.click(tab("インポート"));
    fireEvent.click(tab("作成"));

    expect(screen.queryByRole("button", { name: "戻る" })).toBeNull();
    expect(hasPiece(7, 7)).toBe(true);
    expect(boardFace().getByLabelText<HTMLInputElement>("ファイル名").value).toBe("45角戦法");
  });

  test("閉じて開き直すと、パネルは盤から始まる", () => {
    const { rerender } = render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));

    params.modal = undefined;
    rerender(<CreateFileModal />);
    params.modal = "create-file";
    rerender(<CreateFileModal />);

    expect(tab("作成").getAttribute("aria-selected")).toBe("true");
  });
});

/** 読める最小の kif。インポートの送信条件（棋譜として読めたこと）を満たすために要る */
const KIF_TEXT = "手数----指手---------消費時間--\n   1 ７六歩(77)   ( 0:00/00:00:00)\n";

/** インポートのタブを出して、送信できるところまで埋める */
function fillImport() {
  fireEvent.click(tab("インポート"));
  fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });
  fireEvent.change(importFace().getByLabelText("ファイル名"), { target: { value: "研究" } });
}

const importForm = (): HTMLFormElement => {
  const form = document.querySelector<HTMLFormElement>(".kifu-import form");
  if (!form) throw new Error("インポートのフォームが無い");
  return form;
};

describe("インポートのタブから閉じる", () => {
  test("組みかけを持ったまま「キャンセル」を押すと確認が出る", () => {
    render(<CreateFileModal />);
    makeDirty();
    fireEvent.click(tab("インポート"));

    fireEvent.click(importFace().getByRole("button", { name: "キャンセル" }));

    expect(screen.getByText("組んだ局面は保存されません。")).toBeTruthy();
    expect(closeModal).not.toHaveBeenCalled();
  });

  test("捨てるものが無ければ、そのまま閉じる", () => {
    render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));

    fireEvent.click(importFace().getByRole("button", { name: "キャンセル" }));

    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  /**
   * 捨てるものはタブごとに在り、**閉じる経路はどちらのタブにもある**。
   * モーダルが両方を数えないと、見ていないほうが黙って消える。
   */
  test("棋譜を貼ったまま閉じようとすると確認が出る", () => {
    render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));
    fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });

    fireEvent.click(importFace().getByRole("button", { name: "キャンセル" }));

    expect(screen.getByText("貼った棋譜は保存されません。")).toBeTruthy();
    expect(closeModal).not.toHaveBeenCalled();
  });

  test("貼った棋譜は、盤のパネルから Esc で閉じようとしても数える", () => {
    render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));
    fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });
    fireEvent.click(tab("作成"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText("貼った棋譜は保存されません。")).toBeTruthy();
    expect(closeModal).not.toHaveBeenCalled();
  });

  // 1つだけを名指すと、もう片方が消えることが確認を読んでも分からない
  test("両方あるときは両方を名指す", () => {
    render(<CreateFileModal />);
    makeDirty();
    fireEvent.click(tab("インポート"));
    fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });

    fireEvent.click(importFace().getByRole("button", { name: "キャンセル" }));

    expect(screen.getByText("組んだ局面と貼った棋譜は保存されません。")).toBeTruthy();
  });

  test("「閉じない」なら、貼ったものは残る", () => {
    render(<CreateFileModal />);
    fireEvent.click(tab("インポート"));
    fireEvent.change(importFace().getByLabelText("棋譜テキスト"), { target: { value: KIF_TEXT } });
    fireEvent.click(importFace().getByRole("button", { name: "キャンセル" }));

    fireEvent.click(screen.getByRole("button", { name: "閉じない" }));

    expect(closeModal).not.toHaveBeenCalled();
    expect(importFace().getByLabelText<HTMLTextAreaElement>("棋譜テキスト").value).toBe(KIF_TEXT);
  });

  test("インポートのタブへ移ると、貼り付け欄に焦点が入る", async () => {
    // 焦点は次のフレームで移す。**親の `Modal` が開いた直後に引き戻すので、
    // 同じターンで移すと奪われる**
    const frame = () =>
      act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    render(<CreateFileModal />);
    await frame();
    // **隠れているあいだに移してはいけない。** 実ブラウザでは `display: none` への
    // `focus()` は何も起きず、そのあとタブで出てきても焦点を動かす経路が無い
    expect(document.activeElement?.id).not.toBe("kifu-import-raw");

    fireEvent.click(tab("インポート"));
    await frame();
    expect(document.activeElement?.id).toBe("kifu-import-raw");
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
    // **組むタブの中から探す。** インポートのタブも木に残っていて、そちらの
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
    // **旗はタブごとに立つ。** 片方しか見ないと、見ていないタブで送信中にモーダルが閉じ、
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

    expect((tab("作成") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeModal).not.toHaveBeenCalled();
    // 貼りかけがあるので、作成中を見落とすと確認が出る。それも出さない（表の W×X10）
    expect(screen.queryByText(/保存されません/)).toBeNull();

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

/**
 * 2つのタブが同じ `id` を名乗ると、ラベルを押したときに隠れているタブの欄へ焦点が入る。
 * ブラウザがラベルから引くのは文書の中で最初にその `id` を持つ要素なので、
 * ここも `getElementById` で引く（タブの中だけを探すと衝突が見えない）。
 */
describe("ラベルと欄", () => {
  test.each([
    [".kifu-import", ["棋譜テキスト", "ファイル名", "形式", "保存先"]],
    [".pos-editor", ["ファイル名", "形式", "保存先", "先手名", "後手名"]],
  ])("%s のラベルは、同じタブの中の欄を指す", (selector, labels) => {
    render(<CreateFileModal />);
    const face = document.querySelector<HTMLElement>(selector);
    if (!face) throw new Error(`タブが無い: ${selector}`);

    for (const text of labels) {
      const label = [...face.querySelectorAll("label")].find((el) => el.textContent === text);
      if (!label) throw new Error(`ラベルが無い: ${text}`);
      const control = document.getElementById(label.htmlFor);
      expect(control, text).not.toBeNull();
      expect(face.contains(control), text).toBe(true);
    }
  });
});
