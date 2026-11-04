// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, startTransition, useState } from "react";
import type { StudyPosition } from "@/entities/study-positions/model/types";

/**
 * 局面を課題局面として保存する対話（`docs/spec/screens/study-positions.md`）。
 *
 * `AppModalLayer` が常にマウントしているので、開くたびにフォームを詰め直すことと、
 * 保存済みの局面なら編集と削除になることを見る。
 */

const SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

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

let loadedAbsPath: string | null = "/root/対局.kif";
vi.mock("@/entities/game", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/game")>();
  return {
    ...actual,
    useGame: () =>
      ({
        state: { loadedAbsPath },
        view: { currentSfen: SFEN },
        getCurrentMoveIndex: () => 12,
      }) as unknown as ReturnType<typeof import("@/entities/game").useGame>,
  } satisfies typeof import("@/entities/game");
});

const addPosition = vi.fn();
const updatePosition = vi.fn();
const deletePosition = vi.fn();
let saved: StudyPosition | null = null;
/**
 * provider の `findBySfen` は一覧を ref から読むので、同一性が動かない。
 * 毎回作り直すと、一覧が届いたことを `findBySfen` の同一性で拾う形でもテストが通る
 */
const findBySfen = () => saved;

vi.mock("@/entities/study-positions/model/useStudyPositions", () => {
  const mocked = {
    useStudyPositions: () =>
      ({
        addPosition,
        updatePosition,
        deletePosition,
        findBySfen,
      }) as unknown as ReturnType<
        typeof import("@/entities/study-positions/model/useStudyPositions").useStudyPositions
      >,
  };
  return mocked satisfies typeof import("@/entities/study-positions/model/useStudyPositions");
});

const { default: StudyPositionSaveModal } = await import("../StudyPositionSaveModal");

const SAVED: StudyPosition = {
  id: "p1",
  sfen: SFEN,
  label: "角換わりの急所",
  description: "先手良し",
  state: "active",
  tags: ["角換わり"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  params.modal = "study-position-save";
  params.sfen = undefined;
  loadedAbsPath = "/root/対局.kif";
  saved = null;
  closeModal.mockReset();
  addPosition.mockReset();
  updatePosition.mockReset();
  deletePosition.mockReset();
});
afterEach(cleanup);

const titleInput = () => screen.getByLabelText<HTMLInputElement>("タイトル");

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("StudyPositionSaveModal", () => {
  test("開いていなければ何も描かない", () => {
    params.modal = undefined;
    render(<StudyPositionSaveModal />);

    expect(document.querySelector(".sp-save")).toBeNull();
  });

  test("盤の局面を保存するときは、手数とファイル名を添える", () => {
    render(<StudyPositionSaveModal />);

    expect(screen.getByText("12手目")).toBeTruthy();
    expect(screen.getByText("対局.kif")).toBeTruthy();
  });

  test("一覧から開いたとき（URL に局面がある）は、盤の手数とファイル名を出さない", () => {
    params.sfen = SFEN;
    render(<StudyPositionSaveModal />);

    expect(screen.queryByText("12手目")).toBeNull();
    expect(screen.queryByText("対局.kif")).toBeNull();
  });

  test("保存していない局面は、打った値で足して閉じる", async () => {
    addPosition.mockResolvedValue(SAVED);
    render(<StudyPositionSaveModal />);

    fireEvent.change(titleInput(), { target: { value: "急所" } });
    fireEvent.click(screen.getByRole("radio", { name: "研究中" }));
    await press("保存");

    expect(addPosition).toHaveBeenCalledWith({
      sfen: SFEN,
      label: "急所",
      state: "active",
      tags: [],
      description: "",
    });
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("保存済みの局面は、記録の値で開いて上書きする", async () => {
    saved = SAVED;
    updatePosition.mockResolvedValue(SAVED);
    render(<StudyPositionSaveModal />);

    expect(screen.getByText("この局面はすでに保存されています")).toBeTruthy();
    expect(titleInput().value).toBe("角換わりの急所");
    fireEvent.change(titleInput(), { target: { value: "急所" } });
    await press("保存する");

    expect(updatePosition).toHaveBeenCalledWith({
      id: "p1",
      label: "急所",
      state: "active",
      tags: ["角換わり"],
      description: "先手良し",
    });
  });

  test("保存に失敗したら理由を出し、打った値を残して閉じない", async () => {
    addPosition.mockRejectedValue(new Error("書き込めませんでした"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<StudyPositionSaveModal />);

    fireEvent.change(titleInput(), { target: { value: "急所" } });
    await press("保存");

    expect(screen.getByText("書き込めませんでした")).toBeTruthy();
    expect(titleInput().value).toBe("急所");
    expect(closeModal).not.toHaveBeenCalled();
  });

  test("⌘+Enter でも保存する", async () => {
    addPosition.mockResolvedValue(SAVED);
    render(<StudyPositionSaveModal />);

    await act(async () => {
      fireEvent.keyDown(titleInput(), { key: "Enter", metaKey: true });
    });

    expect(addPosition).toHaveBeenCalledTimes(1);
  });

  test("削除は確認を通してから消す", async () => {
    saved = SAVED;
    deletePosition.mockResolvedValue(undefined);
    render(<StudyPositionSaveModal />);

    await press("削除");
    expect(deletePosition).not.toHaveBeenCalled();
    await press("削除する");

    expect(deletePosition).toHaveBeenCalledWith("p1");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("開いた後に記録が届いたら、空のフォームを記録の値で詰め直す", () => {
    const view = render(<StudyPositionSaveModal />);
    expect(screen.getByRole("heading").textContent).toBe("局面を保存");

    saved = SAVED;
    view.rerender(<StudyPositionSaveModal />);

    expect(screen.getByRole("heading").textContent).toBe("課題局面を編集");
    expect(titleInput().value).toBe("角換わりの急所");
  });

  test("打った後に記録が届いても、打った値を残す", () => {
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });

    saved = SAVED;
    view.rerender(<StudyPositionSaveModal />);

    expect(titleInput().value).toBe("急所");
    // 新規の形のまま。保存すると `addPosition` が開き直すよう案内する
    expect(screen.getByRole("heading").textContent).toBe("局面を保存");
  });

  test("足している間に一覧が先に差し替わっても、題を変えない", async () => {
    let resolve: (p: StudyPosition) => void = () => undefined;
    addPosition.mockReturnValue(new Promise<StudyPosition>((r) => (resolve = r)));
    const view = render(<StudyPositionSaveModal />);
    // 何も打たずに保存する。打っていれば、届いた記録で詰め直さない別の理由で通る
    await press("保存");

    // provider は書き込む前に一覧を差し替える
    saved = SAVED;
    view.rerender(<StudyPositionSaveModal />);
    expect(screen.getByRole("heading").textContent).toBe("局面を保存");

    await act(async () => resolve(SAVED));
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("消している間に一覧が先に差し替わっても、題を変えない", async () => {
    saved = SAVED;
    deletePosition.mockReturnValue(new Promise<void>(() => undefined));
    const view = render(<StudyPositionSaveModal />);
    await press("削除");
    await press("削除する");

    saved = null;
    view.rerender(<StudyPositionSaveModal />);
    expect(screen.getByRole("heading").textContent).toBe("課題局面を編集");
  });

  test("足すのに失敗して一覧が戻っても、打った値を残す", async () => {
    let reject: (e: Error) => void = () => undefined;
    addPosition.mockReturnValue(new Promise<StudyPosition>((_, r) => (reject = r)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });
    await press("保存");

    saved = { ...SAVED, label: "急所" };
    view.rerender(<StudyPositionSaveModal />);
    saved = null;
    await act(async () => reject(new Error("書き込めませんでした")));

    expect(screen.getByText("書き込めませんでした")).toBeTruthy();
    expect(titleInput().value).toBe("急所");
  });

  test("読み直して保存済みと分かっても、打った値と理由を残す", async () => {
    // 起動時の読み込みに失敗していると、保存の前の読み直しで記録が見つかる
    addPosition.mockImplementation(() => {
      saved = SAVED;
      return Promise.reject(new Error("この局面はもう保存されています。開き直すと編集できます"));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });
    await press("保存");
    view.rerender(<StudyPositionSaveModal />);

    expect(screen.getByText(/もう保存されています/)).toBeTruthy();
    expect(titleInput().value).toBe("急所");
  });

  test("開いている間に別の記録の局面へ変わったら、その記録で詰め直す", () => {
    saved = SAVED;
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });

    saved = { ...SAVED, id: "p2", label: "矢倉の急所" };
    view.rerender(<StudyPositionSaveModal />);

    expect(titleInput().value).toBe("矢倉の急所");
  });

  test("上書きに失敗して、読み直した同じ記録が戻っても、打った値を残す", async () => {
    saved = SAVED;
    // 読み直すと、同じ記録が別の参照で一覧に入る
    updatePosition.mockImplementation(() => {
      saved = { ...SAVED };
      return Promise.reject(new Error("書き込めませんでした"));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });
    await press("保存する");
    view.rerender(<StudyPositionSaveModal />);

    expect(screen.getByText("書き込めませんでした")).toBeTruthy();
    expect(titleInput().value).toBe("急所");
  });

  /**
   * `closeModal` は router の `navigate` を通り、`BrowserRouter` はそれを transition で包む。
   * 閉じる描画は、同じ handler の中の `setIsSaving(false)` より後に来る
   */
  function renderClosingByTransition() {
    const titles: string[] = [];
    let close = () => {};
    function Host() {
      const [modal, setModal] = useState(params.modal);
      params.modal = modal;
      close = () => startTransition(() => setModal(undefined));
      return (
        <Profiler
          id="save"
          onRender={() =>
            titles.push(document.querySelector(".sp-save__title")?.textContent ?? "(closed)")
          }
        >
          <StudyPositionSaveModal />
        </Profiler>
      );
    }
    closeModal.mockImplementation(() => close());
    render(<Host />);
    return titles;
  }

  test("消して閉じるまで、見出しを変えない", async () => {
    saved = SAVED;
    deletePosition.mockImplementation(async () => {
      saved = null;
    });
    const titles = renderClosingByTransition();
    await press("削除");
    await press("削除する");

    expect(titles[titles.length - 1]).toBe("(closed)");
    expect(titles.filter((t) => t === "局面を保存")).toEqual([]);
  });

  test("何も打たずに足して閉じるまで、見出しを変えない", async () => {
    addPosition.mockImplementation(async () => {
      saved = SAVED;
      return SAVED;
    });
    const titles = renderClosingByTransition();
    await press("保存");

    expect(titles[titles.length - 1]).toBe("(closed)");
    expect(titles.filter((t) => t === "課題局面を編集")).toEqual([]);
  });

  test("保存して閉じた後に開き直すと、また保存できる", async () => {
    addPosition.mockResolvedValue(SAVED);
    const view = render(<StudyPositionSaveModal />);
    await press("保存");
    expect(closeModal).toHaveBeenCalledTimes(1);

    params.modal = undefined;
    view.rerender(<StudyPositionSaveModal />);
    params.modal = "study-position-save";
    view.rerender(<StudyPositionSaveModal />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled).toBe(false);
  });

  test("閉じて開き直すと、打った値は消える", () => {
    const view = render(<StudyPositionSaveModal />);
    fireEvent.change(titleInput(), { target: { value: "急所" } });

    params.modal = undefined;
    view.rerender(<StudyPositionSaveModal />);
    params.modal = "study-position-save";
    view.rerender(<StudyPositionSaveModal />);

    expect(titleInput().value).toBe("");
  });
});
