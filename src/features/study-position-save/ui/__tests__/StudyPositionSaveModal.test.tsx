// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@/entities/study-positions/model/useStudyPositions", () => {
  const mocked = {
    useStudyPositions: () =>
      ({
        addPosition,
        updatePosition,
        deletePosition,
        findBySfen: () => saved,
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
