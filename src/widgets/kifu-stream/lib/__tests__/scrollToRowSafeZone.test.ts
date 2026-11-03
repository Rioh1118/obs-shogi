import { describe, expect, test, vi } from "vitest";
import { scrollToRowSafeZone } from "../scrollToRowSafeZone";

/**
 * カーソルの行を一覧の見える位置へ戻す流し方。
 *
 * 中央の帯にある行で流すと、矢印キーで1手進めるたびに一覧が揺れる。
 * 帯の外の行を流さないと、カーソルの行が画面の外へ出たまま戻らない。
 */

/** 表示の高さ400、行の高さ20。上下の帯は100ずつで、`lookAhead` は8 */
function scroller(scrollTop: number, scrollHeight = 2000) {
  return {
    clientHeight: 400,
    scrollTop,
    scrollHeight,
    scrollTo: vi.fn<(opts: ScrollToOptions) => void>(),
  };
}

const row = (offsetTop: number) => ({ offsetTop, offsetHeight: 20 }) as HTMLElement;

function scrolledTo(s: ReturnType<typeof scroller>, rowTop: number) {
  scrollToRowSafeZone(s as unknown as HTMLElement, row(rowTop), "auto");
  return s.scrollTo.mock.calls.length === 0 ? null : s.scrollTo.mock.calls[0][0].top;
}

describe("scrollToRowSafeZone", () => {
  test("中央の帯に収まる行では流さない", () => {
    expect(scrolledTo(scroller(1000), 1100)).toBeNull();
    expect(scrolledTo(scroller(1000), 1280)).toBeNull();
  });

  test("上の帯にかかる行は、帯の境目の少し手前まで戻す", () => {
    expect(scrolledTo(scroller(1000), 1099)).toBe(1007);
  });

  test("下の帯にかかる行は、帯の境目の少し手前まで進める", () => {
    expect(scrolledTo(scroller(1000), 1281)).toBe(993);
  });

  test("流す先は一覧の端を越えない", () => {
    expect(scrolledTo(scroller(100), 20)).toBe(0);
    expect(scrolledTo(scroller(1500, 1800), 1790)).toBe(1400);
  });

  test("渡された流し方をそのまま使う", () => {
    const s = scroller(1000);
    scrollToRowSafeZone(s as unknown as HTMLElement, row(1500), "smooth");
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 1212, behavior: "smooth" });
  });
});
