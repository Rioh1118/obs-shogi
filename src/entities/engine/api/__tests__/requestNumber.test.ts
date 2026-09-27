import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * 番号は webview の読み直しを跨いで下がらないこと。Rust の「最新」はアプリのプロセスが続く間残るので、
 * 読み直した後の番号が小さいと、解析の起動も申告の取得も黙って断られる
 */
async function freshModule() {
  vi.resetModules();
  return await import("../requestNumber");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("nextRequestNumber", () => {
  test("読み直した後の最初の番号は、読み直す前の最後の番号より大きい", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const before = await freshModule();
    let lastBefore = 0;
    for (let i = 0; i < 50; i++) lastBefore = before.nextRequestNumber();

    // 読み直しには時間がかかる
    vi.setSystemTime(1_000_500);
    const after = await freshModule();

    expect(after.nextRequestNumber()).toBeGreaterThan(lastBefore);
  });

  test("同じミリ秒に続けて作っても、番号は増え続ける", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const { nextRequestNumber } = await freshModule();

    const a = nextRequestNumber();
    const b = nextRequestNumber();
    expect(b).toBeGreaterThan(a);
  });
});
