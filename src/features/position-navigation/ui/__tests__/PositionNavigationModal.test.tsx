// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JKFPlayer } from "json-kifu-format";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import type { CursorPath } from "@/entities/kifu/model/cursor";

/**
 * 局面ナビ（`docs/spec/screens/position-navigation.md`）。
 *
 * 開いたときは盤の位置から始め、確定するまで盤を動かさない。
 * 確定で渡すのはプレビューが見ている位置で、戻った後の先の選択も含む。
 */

const closeModal = vi.fn();
const params: { modal?: string } = {};

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

const applyCursor = vi.fn();
let player: JKFPlayer | null = null;
let cursor: CursorPath = { tesuu: 0, forkPointers: [] };

vi.mock("@/entities/game", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/game")>();
  return {
    ...actual,
    useGame: () =>
      ({
        state: { cursor },
        view: { player },
        applyCursor,
      }) as unknown as ReturnType<typeof import("@/entities/game").useGame>,
  } satisfies typeof import("@/entities/game");
});

const { default: PositionNavigationModal } = await import("../PositionNavigationModal");

/** 2手目に変化が2本ある棋譜。変化1は2手で終わり、変化2は1手で終わる */
const KIFU = `手合割：平手
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２六歩(27)

変化：2手
   2 ８四歩(83)
   3 ６八銀(79)

変化：2手
   2 ４四歩(43)
`;

function load(text: string) {
  player = new JKFPlayer(parseKifuContentToJKF(text, "kif"));
}

beforeEach(() => {
  params.modal = "navigation";
  load(KIFU);
  cursor = { tesuu: 0, forkPointers: [] };
  closeModal.mockReset();
  applyCursor.mockReset();
});
afterEach(cleanup);

function press(key: string) {
  return fireEvent.keyDown(window, { key });
}

const cards = () => [...document.querySelectorAll(".branch-selector__card")];
const cardLabels = () =>
  cards().map((c) => c.querySelector(".branch-selector__label")?.textContent);
const selectedCardLabel = () =>
  document.querySelector(".branch-selector__card--selected .branch-selector__label")?.textContent;
const chips = () =>
  [...document.querySelectorAll(".position-navigation-modal__chip")].map((c) => c.textContent);

describe("PositionNavigationModal", () => {
  test("開いていなければ何も描かず、鍵も拾わない", () => {
    params.modal = undefined;
    render(<PositionNavigationModal />);

    expect(document.querySelector(".position-navigation-modal")).toBeNull();
    expect(press("Enter")).toBe(true);
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("盤の位置から始め、次の手の候補を本譜、変化の順に出す", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    render(<PositionNavigationModal />);

    expect(chips()).toEqual(["1手目", "選択:本譜"]);
    expect(cardLabels()).toEqual(["本譜", "変化1", "変化2"]);
    expect(selectedCardLabel()).toBe("本譜");
  });

  test("j / k と上下で候補を選び、端で止まる", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    render(<PositionNavigationModal />);

    press("k");
    expect(selectedCardLabel()).toBe("本譜");
    press("j");
    expect(selectedCardLabel()).toBe("変化1");
    press("ArrowDown");
    press("ArrowDown");
    expect(selectedCardLabel()).toBe("変化2");
    expect(chips()).toEqual(["1手目", "選択:変化2"]);
    press("ArrowUp");
    expect(selectedCardLabel()).toBe("変化1");
  });

  test("札を押すとその候補を選ぶ", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    render(<PositionNavigationModal />);

    fireEvent.click(cards()[2]);
    expect(selectedCardLabel()).toBe("変化2");
  });

  test("l で選んだ候補へ進み、選択を本譜に戻す。確定で盤へ渡して閉じる", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    render(<PositionNavigationModal />);

    press("j");
    press("l");
    expect(chips()).toEqual(["2手目", "選択:本譜"]);
    // 変化1の次の手（3手目の６八銀）だけが候補に出る
    expect(cardLabels()).toEqual(["本譜"]);
    expect(applyCursor).not.toHaveBeenCalled();

    press("Enter");
    expect(applyCursor).toHaveBeenCalledWith({
      tesuu: 2,
      forkPointers: [{ te: 2, forkIndex: 0 }],
    });
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("h は1手戻り、先の選択を残したまま確定に渡す", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    render(<PositionNavigationModal />);

    press("j");
    press("ArrowRight");
    press("ArrowLeft");
    expect(chips()).toEqual(["1手目", "選択:本譜"]);

    press("Enter");
    expect(applyCursor).toHaveBeenCalledWith({
      tesuu: 1,
      forkPointers: [{ te: 2, forkIndex: 0 }],
    });
  });

  test("開始局面より前へは戻らない", () => {
    render(<PositionNavigationModal />);

    press("h");
    expect(chips()).toEqual(["0手目", "選択:本譜"]);
    press("l");
    expect(chips()).toEqual(["1手目", "選択:本譜"]);
  });

  test("次の手が無い局面では案内を出し、l で動かない", () => {
    cursor = { tesuu: 3, forkPointers: [] };
    render(<PositionNavigationModal />);

    expect(screen.getByText("この局面には次の手がありません")).toBeTruthy();
    press("l");
    expect(chips()).toEqual(["3手目", "選択:—"]);
  });

  test("扱った鍵だけ既定の動作を止める", () => {
    render(<PositionNavigationModal />);

    expect(press("j")).toBe(false);
    expect(press("Tab")).toBe(true);
    expect(press("x")).toBe(true);
  });

  test("盤上で辿れない位置では理由を出し、確定しない", () => {
    cursor = { tesuu: 2, forkPointers: [{ te: 2, forkIndex: -1 }] };
    render(<PositionNavigationModal />);

    expect(screen.getByText(/2\s*手目を盤上で再現できません/)).toBeTruthy();
    press("Enter");
    expect(applyCursor).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });

  test("棋譜が無ければ確定しない", () => {
    player = null;
    render(<PositionNavigationModal />);

    press("Enter");
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("開き直すと、盤の位置から始め直す", () => {
    cursor = { tesuu: 1, forkPointers: [] };
    const { rerender } = render(<PositionNavigationModal />);
    press("l");
    press("l");
    expect(chips()[0]).toBe("3手目");

    params.modal = undefined;
    rerender(<PositionNavigationModal />);
    params.modal = "navigation";
    rerender(<PositionNavigationModal />);

    expect(chips()[0]).toBe("1手目");
  });
});
