// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EngineAction } from "../EngineAction";
import { EngineStatusLabel } from "../EngineStatusLabel";

/** 操作列の語とボタン（`docs/spec/features/engine-standardization.md` の「エンジンの状態」） */
const statusText = (container: HTMLElement) =>
  container.querySelector(".analysis-controls__status")?.textContent;

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("操作列の語", () => {
  test("待機中は経過時間を出さない", () => {
    const { container } = render(<EngineStatusLabel status="standing-by" currentSfen="P1" />);
    expect(statusText(container)).toBe("待機中");
  });

  test.each([
    ["starting", "起動中…"],
    ["failed", "起動失敗"],
    ["cancelled", "起動を中止しました"],
  ] as const)("%s は語だけで、経過時間が残らない", (status, word) => {
    const { container } = render(<EngineStatusLabel status={status} currentSfen="P1" />);
    expect(statusText(container)).toBe(word);
  });

  test("応答なしは語だけで、経過時間が残らない", () => {
    const { container } = render(<EngineStatusLabel status="unresponsive" currentSfen="P1" />);
    expect(statusText(container)).toBe("応答なし");
  });

  test("エンジン終了は語だけで、経過時間が残らない", () => {
    const { container } = render(<EngineStatusLabel status="exited" currentSfen="P1" />);
    expect(statusText(container)).toBe("エンジン終了");
  });

  test("検討中は時間が進み、局面が変わると 0 に戻る", () => {
    vi.useFakeTimers();
    const view = render(<EngineStatusLabel status="analyzing" currentSfen="P1" />);
    act(() => void vi.advanceTimersByTime(3000));
    expect(statusText(view.container)).toBe("検討中3s");

    view.rerender(<EngineStatusLabel status="analyzing" currentSfen="P2" />);
    expect(statusText(view.container)).toBe("検討中0s");
  });

  test("検討完了は止まった時点の値で止まる", () => {
    vi.useFakeTimers();
    const view = render(<EngineStatusLabel status="analyzing" currentSfen="P1" />);
    act(() => void vi.advanceTimersByTime(2000));

    view.rerender(<EngineStatusLabel status="finished" currentSfen="P1" />);
    act(() => void vi.advanceTimersByTime(5000));

    expect(statusText(view.container)).toBe("検討完了2s");
  });
});

describe("操作列の時計の持ち越し", () => {
  test("待機中を挟んだら、すぐ終わった回に前回の値を出さない", () => {
    vi.useFakeTimers();
    const view = render(<EngineStatusLabel status="analyzing" currentSfen="P1" />);
    act(() => void vi.advanceTimersByTime(4000));

    view.rerender(<EngineStatusLabel status="standing-by" currentSfen="P1" />);
    view.rerender(<EngineStatusLabel status="finished" currentSfen="P1" />);

    expect(statusText(view.container)).toBe("検討完了0s");
  });
});

describe("▶ の位置のボタン", () => {
  const handlers = () => ({ onToggle: vi.fn(), onRestart: vi.fn() });

  test("検討していなければ ▶、局面が無ければ押せない", () => {
    render(
      <EngineAction
        status="standing-by"
        isAnalyzing={false}
        stopping={false}
        canStart={false}
        {...handlers()}
      />,
    );
    expect((screen.getByTitle("検討を開始") as HTMLButtonElement).disabled).toBe(true);
  });

  test("中断を頼んだ後は、語が検討中のまま ■ を押せない", () => {
    render(<EngineAction status="analyzing" isAnalyzing stopping canStart {...handlers()} />);
    expect((screen.getByTitle("検討を中断") as HTMLButtonElement).disabled).toBe(true);
  });

  test("検討完了は ■ で、押すと中断する", () => {
    const on = handlers();
    render(<EngineAction status="finished" isAnalyzing stopping={false} canStart {...on} />);

    fireEvent.click(screen.getByTitle("検討を中断"));
    expect(on.onToggle).toHaveBeenCalledTimes(1);
  });

  test.each(["exited", "unresponsive"] as const)("%s は再起動になり、■ が残らない", (status) => {
    const on = handlers();
    render(<EngineAction status={status} isAnalyzing stopping={false} canStart {...on} />);

    expect(screen.queryByTitle("検討を中断")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "再起動する" }));
    expect(on.onRestart).toHaveBeenCalledTimes(1);
  });
});
