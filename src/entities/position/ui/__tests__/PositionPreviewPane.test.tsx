// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { GOTE_LABEL, SENTE_LABEL } from "@/shared/lib/turn";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PositionPreviewPane from "../PositionPreviewPane";

/**
 * 局面のプレビューが描くものを固定する。
 *
 * 盤の一辺は枠を測って決めるので、枠の測り方が外れると盤が読めない大きさのまま残る。
 */

type Measure = (entries: { contentRect: { width: number; height: number } }[]) => void;

/** 測った結果を手で流す。happy-dom は寸法を持たないので、実物の通知が来ない */
let observers: Measure[] = [];

class FakeResizeObserver {
  private readonly measure: Measure;
  constructor(measure: Measure) {
    this.measure = measure;
  }
  observe() {
    observers.push(this.measure);
  }
  disconnect() {
    observers = observers.filter((measure) => measure !== this.measure);
  }
}

/** 枠の内寸を流す。余白は `--board-pad` の下限の 8px を四辺に置く */
function resizeFrame(width: number, height: number) {
  const frame = document.querySelector<HTMLElement>(".position-navigation-modal__board-preview");
  frame?.style.setProperty("padding", "8px");
  act(() => observers.forEach((measure) => measure([{ contentRect: { width, height } }])));
}

function boardSize(): string | undefined {
  const board = document.querySelector<HTMLElement>(".board-preview");
  return board?.style.getPropertyValue("--board-size");
}

function squares(): Element[] {
  return [...document.querySelectorAll(".board-preview__square")];
}

function handRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = (sfen: string) => buildPreviewDataFromSfen(sfen);

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

describe("局面のプレビュー", () => {
  test("盤は左上を9一として81升を並べる", () => {
    render(<PositionPreviewPane previewData={preview("k7P/9/9/9/9/9/9/9/8+R b - 1")} />);
    const all = squares();
    expect(all).toHaveLength(81);
    expect(all[0].querySelector(".piece__king.gote")).toBeTruthy();
    expect(all[8].querySelector(".piece__pawn.sente")).toBeTruthy();
    expect(all[80].querySelector(".piece__dragon.sente")).toBeTruthy();
    expect(document.querySelectorAll(".piece")).toHaveLength(3);
  });

  test("持ち駒は盤の下に、種類の順で枚数を添えて出す", () => {
    render(<PositionPreviewPane previewData={preview("9/9/9/9/9/9/9/9/9 b RG2Pn 1")} />);
    const sente = handRow(SENTE_LABEL);
    expect([...sente.querySelectorAll("span")].map((chip) => chip.textContent)).toEqual([
      "歩×2",
      "金",
      "飛",
    ]);
    expect(handRow(GOTE_LABEL).textContent).toContain("桂");
  });

  test("持ち駒が無い側は「なし」と出す", () => {
    render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    expect(handRow(SENTE_LABEL).textContent).toContain("なし");
    expect(handRow(GOTE_LABEL).textContent).toContain("なし");
  });

  test("局面が無ければ読み込み中と出し、盤を描かない", () => {
    render(<PositionPreviewPane previewData={null} />);
    expect(screen.getByText("局面を読み込み中…")).toBeTruthy();
    expect(document.querySelector(".board-preview")).toBeNull();
  });

  test("測る前は 320px で描き、升と駒の寸法を一辺から導く", () => {
    render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    expect(boardSize()).toBe("320px");
    const board = document.querySelector<HTMLElement>(".board-preview");
    expect(board?.style.getPropertyValue("--square-size")).toBe(`${320 / 9}px`);
    expect(board?.style.getPropertyValue("--piece-size")).toBe(`${(320 / 9) * 0.8}px`);
  });

  test("プレビューは押しても何も起きない形で描く", () => {
    render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    expect(document.querySelector(".board-preview__square")?.className).toBe(
      "board-preview__square",
    );
  });

  test("枠を測ると盤の一辺が追う", () => {
    render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    resizeFrame(500, 500);
    expect(boardSize()).toBe("484px");
  });

  test("閉じたら測るのをやめる", () => {
    const { unmount } = render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    unmount();
    expect(observers).toHaveLength(0);
  });

  // 検討の一覧や検索は、行を選ぶまで局面が無い状態で開く
  test("局面が後から届いても枠を測る", () => {
    const { rerender } = render(<PositionPreviewPane previewData={null} />);
    rerender(<PositionPreviewPane previewData={preview(HIRATE)} />);
    resizeFrame(500, 500);
    expect(boardSize()).toBe("484px");
  });
});
