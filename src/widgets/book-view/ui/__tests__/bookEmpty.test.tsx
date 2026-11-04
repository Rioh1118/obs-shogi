// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BookEmpty from "../BookEmpty";

/**
 * 定跡を開いていない画面の一覧と押下。
 *
 * 押した行のパスを呼び手へ渡すこと。別のパスが渡ると、押した名前と違う定跡が開く。
 */

const target = (path: string, note: string) => ({
  path,
  name: path.split("/").pop() ?? path,
  note,
});

afterEach(() => cleanup());

describe("定跡を開いていない画面", () => {
  test("束ごとに見出しを付けて並べ、押した行のパスを渡す", () => {
    const onOpen = vi.fn();
    render(
      <BookEmpty
        fromPreset={[target("/ai/a.db", "研究 の定跡")]}
        recent={[target("/books/b.db", "/books")]}
        onOpen={onOpen}
        onBrowse={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "このエンジンの定跡" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "最近開いた定跡" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /b\.db/ }));
    expect(onOpen).toHaveBeenCalledWith("/books/b.db");
  });

  test("空の束は見出しごと出さない", () => {
    render(
      <BookEmpty
        fromPreset={[]}
        recent={[target("/books/b.db", "/books")]}
        onOpen={() => {}}
        onBrowse={() => {}}
      />,
    );

    expect(screen.queryByRole("heading", { name: "このエンジンの定跡" })).toBeNull();
    expect(screen.getByRole("heading", { name: "最近開いた定跡" })).toBeTruthy();
  });

  test("別の定跡を開くはダイアログへ渡す", () => {
    const onBrowse = vi.fn();
    render(<BookEmpty fromPreset={[]} recent={[]} onOpen={() => {}} onBrowse={onBrowse} />);

    fireEvent.click(screen.getByRole("button", { name: /別の定跡を開く/ }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});
