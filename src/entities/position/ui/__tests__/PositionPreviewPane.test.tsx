// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GOTE_LABEL, SENTE_LABEL } from "@/shared/lib/turn";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PositionPreviewPane from "../PositionPreviewPane";

function squares(): Element[] {
  return [...document.querySelectorAll(".board-preview__square")];
}

function handRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

afterEach(cleanup);

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

  test("種類の順に無い駒は、順のある駒の後ろに出す", () => {
    const data = preview(HIRATE);
    if (!data) throw new Error("平手が読めない");
    data.hands[0] = ["OU", "KA", "FU"];
    render(<PositionPreviewPane previewData={data} />);
    const chips = [...handRow(SENTE_LABEL).querySelectorAll("span")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["歩", "角", "玉"]);
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

  test("プレビューは押しても何も起きない形で描く", () => {
    render(<PositionPreviewPane previewData={preview(HIRATE)} />);
    expect(document.querySelector(".board-preview__square")?.className).toBe(
      "board-preview__square",
    );
  });

  // 消すと、局面が届くたびに盤の大きさが変わる
  test("局面が無いあいだも、手番と持ち駒の行を空のまま残す", () => {
    const { rerender } = render(<PositionPreviewPane previewData={null} />);
    const rows = () => [
      document.querySelector(".position-preview__turn")?.textContent,
      document.querySelector(".position-preview__hands")?.textContent,
    ];
    expect(rows()).toEqual(["", ""]);

    rerender(<PositionPreviewPane previewData={preview(HIRATE)} />);
    expect(rows().every((text) => text !== "")).toBe(true);
  });
});
