// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

/**
 * 設定「表示」タブ。**候補手の見せ方を選ばせる唯一の口。**
 *
 * ドックの操作列には置かない —— 局面ごとに変える値ではなく好みなので
 * （ADR-0010 決定4 の改訂）。見せ方が実際に効くことは
 * `widgets/analysis-pane/ui/__tests__/analysisDisplayMode.test.tsx` が見る。
 */
const saved = { config: null as Record<string, unknown> | null };
const setDisplayConfig = vi.fn(async () => ({ success: true as const, data: undefined }));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: saved.config, setDisplayConfig }),
}));

const { default: DisplayTab } = await import("../DisplayTab");

/** 見せ方の選択肢。**綴りで引く** —— 読み上げ名には見本の添え書きまで入る */
const modeInputs = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLInputElement>('input[name="analysis-display-mode"]'),
];

beforeEach(() => {
  saved.config = null;
  setDisplayConfig.mockClear();
});

afterEach(cleanup);

describe("設定「表示」タブ", () => {
  test("見せ方は3つとも選択肢に出て、既定が選ばれている", () => {
    const { container } = render(<DisplayTab />);

    const inputs = modeInputs(container);

    expect(inputs.map((i) => i.value)).toEqual(["table", "rows", "detail"]);
    expect(inputs.filter((i) => i.checked).map((i) => i.value)).toEqual(["table"]);
  });

  test("選ぶと設定へ書く", () => {
    const { container } = render(<DisplayTab />);

    const detail = modeInputs(container).find((i) => i.value === "detail")!;
    fireEvent.click(detail);

    expect(setDisplayConfig).toHaveBeenCalledWith({ analysis_display_mode: "detail" });
  });

  test("設定に残っている綴りが選ばれた状態で開く", () => {
    saved.config = { analysis_display_mode: "rows" };
    const { container } = render(<DisplayTab />);

    expect(
      modeInputs(container)
        .filter((i) => i.checked)
        .map((i) => i.value),
    ).toEqual(["rows"]);
  });

  /**
   * **名前だけでは何が変わるか読めない。** 並び方そのものを出す。
   * 見本は骨だけなので、読み上げは選択肢のラベルが担う（`aria-hidden`）。
   */
  test("選択肢に見本が付いていて、読み上げからは外れている", () => {
    const { container } = render(<DisplayTab />);

    const previews = container.querySelectorAll(".displayModePreview");

    expect(previews).toHaveLength(3);
    expect([...previews].every((p) => p.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("評価値バーは既定で入っていない", () => {
    const { container } = render(<DisplayTab />);

    // タブの出し入れも checkbox なので、**最後の1つ**を取る（評価値バーは節がいちばん下）
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    expect(boxes[boxes.length - 1].checked).toBe(false);
  });
});
