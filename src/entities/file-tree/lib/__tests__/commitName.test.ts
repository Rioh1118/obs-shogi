import { describe, expect, test, vi } from "vitest";
import { commitName } from "../commitName";

/**
 * 入力欄に返してよいのは、名前を直せば通る失敗だけ。
 * それ以外を返すと、通知に積まれた同じ失敗と2つの形で同時に出る。
 */

const ok = { success: true, data: undefined } as const;
const fail = (code: string) => ({ success: false, error: { code, message: code } }) as never;

describe("commitName", () => {
  test("手前の検証で落ちた名前は、そのまま入力欄へ返す", async () => {
    const run = vi.fn();

    const res = await commitName("研究/2026", run, vi.fn());

    expect(run).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      shown: expect.objectContaining({ code: "invalid_name_separator" }),
    });
  });

  test("前後の空白を落とした名前で実行する", async () => {
    const run = vi.fn().mockResolvedValue(ok);
    const onCommitted = vi.fn();

    expect(await commitName("  研究  ", run, onCommitted)).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("研究");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  test("名前の失敗は入力欄へ返す", async () => {
    const res = await commitName(
      "研究",
      () => Promise.resolve(fail("invalid_name_reserved")),
      vi.fn(),
    );

    expect(res).toEqual({
      ok: false,
      shown: expect.objectContaining({ code: "invalid_name_reserved" }),
    });
  });

  // 拡張子も名前の一部。落とすと、直すための入力欄ごと消える
  test("拡張子の失敗も入力欄へ返す", async () => {
    const res = await commitName("研究", () => Promise.resolve(fail("invalid_extension")), vi.fn());

    expect(res).toEqual({
      ok: false,
      shown: expect.objectContaining({ code: "invalid_extension" }),
    });
  });

  // 呼び出し側は3つの widget に5経路ある。1つ書き忘れても型検査もテストも
  // 落ちないので、ここへ寄せた
  test("通らなかったら閉じない", async () => {
    const onCommitted = vi.fn();

    await commitName("研究", () => Promise.resolve(fail("permission_denied")), onCommitted);

    expect(onCommitted).not.toHaveBeenCalled();
  });

  // already_exists は衝突の対話、残りは通知。どちらも編集行ごと畳まれる
  test("名前を直しても通らない失敗は返さない。通知か対話が引き取る", async () => {
    for (const code of ["permission_denied", "io", "not_found", "already_exists"]) {
      expect(await commitName("研究", () => Promise.resolve(fail(code)), vi.fn()), code).toEqual({
        ok: false,
        shown: undefined,
      });
    }
  });
});
