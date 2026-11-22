// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import HandHeader from "../HandHeader";

/**
 * 駒台の見出し。側の記号と対局者名。
 *
 * 長い名前は省かず、盤の左右の空きまで広がってから折り返す（`HandHeader.scss`）。
 */

afterEach(cleanup);

describe("駒台の見出し", () => {
  test("長い名前も省かずに出し、題にも持つ", () => {
    const name = "あいうえおかきくけこさしすせそたちつてとなにぬねの";
    render(<HandHeader side="sente" name={name} placement="bottom" isTurn={false} />);

    expect(screen.getByText(name).getAttribute("title")).toBe(name);
  });

  test.each([null, undefined, ""])("名前が %j なら — を出す", (name) => {
    render(<HandHeader side="gote" name={name} placement="top" isTurn={false} />);

    expect(screen.getByText("—").getAttribute("title")).toBe("");
  });

  test.each([
    ["sente", "bottom", "先手", "☗"],
    ["sente", "top", "先手", "⛊"],
    ["gote", "bottom", "後手", "☖"],
    ["gote", "top", "後手", "⛉"],
  ] as const)("%s を %s に置くと、印は %s の %s", (side, placement, label, symbol) => {
    render(<HandHeader side={side} name="名" placement={placement} isTurn={false} />);

    expect(screen.getByLabelText(label).textContent).toBe(symbol);
  });

  test("盤を回したときは、見出しだけ回し戻す", () => {
    const { container } = render(
      <HandHeader side="sente" name="名" placement="top" boardRotated isTurn={false} />,
    );

    expect(container.querySelector(".hand-header--counterRotate")).not.toBeNull();
  });

  test.each([
    ["sente", "先手番"],
    ["gote", "後手番"],
  ] as const)("%s の手番なら、名前に添えて %s と出す", (side, text) => {
    render(<HandHeader side={side} name="名" placement="bottom" isTurn />);

    expect(screen.getByText(text)).toBeTruthy();
  });

  test("手番でない側には出さない", () => {
    const { container } = render(
      <HandHeader side="sente" name="名" placement="bottom" isTurn={false} />,
    );

    expect(container.textContent).toBe("☗名");
  });
});
