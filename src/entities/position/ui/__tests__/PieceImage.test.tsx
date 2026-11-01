// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Color, type Kind } from "shogi.js";
import PieceImage from "../PieceImage";

/**
 * 駒の描き分けを固定する。
 *
 * `Piece.scss` は `piece__<駒>` で画像の幅を決め、盤と駒台のテストはこのクラスで駒を読む。
 * 綴りが1つずれると、その駒だけ大きさが変わるか、別の駒として読まれる。
 */

afterEach(cleanup);

const PIECES: [Kind, string, string, string][] = [
  ["FU", "pawn", "pawn", "歩"],
  ["KY", "lance", "lance", "香"],
  ["KE", "knight", "knight", "桂馬"],
  ["GI", "silver", "silver", "銀"],
  ["KI", "gold", "gold", "金"],
  ["KA", "bishop", "bishop", "角"],
  ["HI", "rook", "rook", "飛"],
  ["TO", "prom-pawn", "prom_pawn", "と"],
  ["NY", "prom-lance", "prom_lance", "成香"],
  ["NK", "prom-knight", "prom_knight", "成桂"],
  ["NG", "prom-silver", "prom_silver", "成銀"],
  ["UM", "horse", "horse", "馬"],
  ["RY", "dragon", "dragon", "龍"],
];

function pieceOf(container: HTMLElement) {
  const piece = container.firstElementChild as HTMLElement;
  const image = piece.querySelector("img") as HTMLImageElement;
  return { piece, image };
}

describe("駒の描き分け", () => {
  test.each(PIECES)("%s は先手と後手で画像と側のクラスだけが変わる", (kind, cls, file, alt) => {
    const black = pieceOf(render(<PieceImage kind={kind} color={Color.Black} />).container);
    expect(black.piece.className).toBe(`piece piece__${cls} sente`);
    expect(black.piece.dataset.color).toBe("0");
    expect(black.piece.dataset.piece).toBe(cls);
    expect(black.image.getAttribute("alt")).toBe(alt);
    expect(black.image.getAttribute("src")).toContain(`black_${file}.png`);
    cleanup();

    const white = pieceOf(render(<PieceImage kind={kind} color={Color.White} />).container);
    expect(white.piece.className).toBe(`piece piece__${cls} gote`);
    expect(white.piece.dataset.color).toBe("1");
    expect(white.image.getAttribute("alt")).toBe(alt);
    expect(white.image.getAttribute("src")).toContain(`white_${file}.png`);
  });

  test("玉は先手が王で後手が玉、後手の画像だけファイル名が違う", () => {
    const black = pieceOf(render(<PieceImage kind="OU" color={Color.Black} />).container);
    expect(black.piece.className).toBe("piece piece__king sente");
    expect(black.piece.dataset.piece).toBe("king");
    expect(black.image.getAttribute("alt")).toBe("王");
    expect(black.image.getAttribute("src")).toContain("black_king.png");
    cleanup();

    const white = pieceOf(render(<PieceImage kind="OU" color={Color.White} />).container);
    expect(white.piece.className).toBe("piece piece__king gote");
    expect(white.image.getAttribute("alt")).toBe("玉");
    expect(white.image.getAttribute("src")).toContain("white_king2.png");
  });

  test("知らない駒は何も描かない", () => {
    const { container } = render(<PieceImage kind="XX" color={Color.Black} />);
    expect(container.firstElementChild).toBeNull();
  });

  test("押すと呼び手へ渡す", () => {
    const onClick = vi.fn();
    const { container } = render(<PieceImage kind="FU" color={Color.Black} onClick={onClick} />);
    fireEvent.click(pieceOf(container).piece);
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("画像は升の外へ運ばせない", () => {
    const { container } = render(<PieceImage kind="FU" color={Color.Black} />);
    expect(pieceOf(container).image.getAttribute("draggable")).toBe("false");
  });
});
