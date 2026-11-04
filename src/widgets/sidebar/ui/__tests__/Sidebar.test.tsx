// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Sidebar from "../Sidebar";

/**
 * サイドバーの開閉。閉じたら中身ごと描かない。
 *
 * 残すと、閉じたはずのパネルがフォーカスの順に残る。
 * 中身がサイドバーの中に入ることは `src/pages/__tests__/sidebarOutlet.test.tsx` が見る。
 */
afterEach(() => cleanup());

describe("サイドバー", () => {
  test("開いていれば中身を描く", () => {
    render(
      <Sidebar isOpen>
        <p>中身</p>
      </Sidebar>,
    );

    expect(screen.getByText("中身")).toBeTruthy();
  });

  test("閉じていれば中身ごと描かない", () => {
    const { container } = render(
      <Sidebar isOpen={false}>
        <p>中身</p>
      </Sidebar>,
    );

    expect(container.textContent).toBe("");
  });
});
