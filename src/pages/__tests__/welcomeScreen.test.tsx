// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

import { KIFU_FORMAT_OPTIONS } from "@/entities/kifu/model/kifu";
import WelcomeScreen from "../WelcomeScreen";

/**
 * 棋譜を開いていないときの画面。作る入口が作るモーダルを開くことと、
 * 並べる形式が作るフォームと同じ一覧から出ていること。
 */

let search = "";
function Probe() {
  search = useLocation().search;
  return null;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/app?tesuu=3"]}>
      <Probe />
      <WelcomeScreen />
    </MemoryRouter>,
  );
}

afterEach(() => {
  search = "";
  cleanup();
});

describe("棋譜を開いていないときの画面", () => {
  test("「棋譜を作成」は保存先を決めずに作るモーダルを開く", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "棋譜を作成" }));

    const params = new URLSearchParams(search);
    expect(params.get("modal")).toBe("create-file");
    expect(params.has("dir")).toBe(false);
  });

  test("作れる形式を、作るフォームと同じ一覧から並べる", () => {
    mount();

    for (const option of KIFU_FORMAT_OPTIONS) {
      expect(screen.getByText(`.${option.value}`)).toBeTruthy();
    }
  });
});
