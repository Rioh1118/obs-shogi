import { describe, expect, test } from "vitest";
import { ENGINE_START_FAILURE_NOTICES, engineFailureNoticeOf } from "../engineNotices";
import type { EngineStartFailure } from "../engineFailure";

const QUIET = {
  phase: "ready",
  error: null,
  unresponsiveReason: null,
  presetIncomplete: false,
} as const;

function failure(kind: EngineStartFailure["kind"]): EngineStartFailure {
  return { kind, message: "", lastOutput: null };
}

describe("engineFailureNoticeOf", () => {
  test("文を出す状態でなければ null", () => {
    expect(engineFailureNoticeOf(QUIET)).toBeNull();
    expect(engineFailureNoticeOf({ ...QUIET, phase: "idle" })).toBeNull();
    expect(engineFailureNoticeOf({ ...QUIET, phase: "initializing" })).toBeNull();
  });

  test("起動の失敗は種類ごとの表から組み、ボタンの語を起動の失敗にする", () => {
    const { tier, body, retry } = ENGINE_START_FAILURE_NOTICES.invalidValue;

    expect(
      engineFailureNoticeOf({ ...QUIET, phase: "error", error: failure("invalidValue") }),
    ).toEqual({
      tier,
      title: "エンジンを起動できませんでした",
      body,
      retry,
      startFailure: true,
    });
  });

  test("失敗の値が欠けていても unknown の文を出す", () => {
    expect(engineFailureNoticeOf({ ...QUIET, phase: "error" })?.body).toBe(
      ENGINE_START_FAILURE_NOTICES.unknown.body,
    );
  });

  /** Rust の `other` とフロントの `unknown` は、どちらも原因を言えない失敗 */
  test("原因を言えない2種類は同じ案内を出す", () => {
    expect(ENGINE_START_FAILURE_NOTICES.other).toEqual(ENGINE_START_FAILURE_NOTICES.unknown);
  });

  test("プロセスが終わったら、もう一度起動を出す", () => {
    expect(engineFailureNoticeOf({ ...QUIET, phase: "exited" })).toMatchObject({
      tier: "danger",
      title: "エンジンが終了しました",
      retry: true,
      startFailure: false,
    });
  });

  test("指示が通らない文は理由で変わり、理由が欠けたら応答なしの文になる", () => {
    const unwritable = engineFailureNoticeOf({
      ...QUIET,
      phase: "unresponsive",
      unresponsiveReason: "unwritable",
    });
    const missing = engineFailureNoticeOf({ ...QUIET, phase: "unresponsive" });

    expect(unwritable).toMatchObject({ title: "エンジンに指示を送信できません", retry: true });
    expect(missing).toMatchObject({ title: "エンジンが中断の指示に応答しません", retry: true });
  });

  test("プリセットが未完成なら再起動を出さず、エンジンの段の文を優先する", () => {
    expect(
      engineFailureNoticeOf({ ...QUIET, phase: "idle", presetIncomplete: true }),
    ).toMatchObject({ tier: "warning", retry: false, startFailure: true });
    expect(
      engineFailureNoticeOf({ ...QUIET, phase: "exited", presetIncomplete: true })?.title,
    ).toBe("エンジンが終了しました");
  });
});
