import { describe, expect, test } from "vitest";
import { asEngineFailure } from "../engineFailure";

/**
 * `invoke` が投げる値は形を信じない。Rust の `StartFailure` のほかに、IPC そのものの
 * 失敗（文字列・`Error`）と、フロントが知らない種類が来うる。**知らないものを既知の種類に
 * 読み替えると、その種類の案内（「もう一度起動」など）が合わない失敗に出る**
 */
describe("asEngineFailure", () => {
  test("Rust の StartFailure はそのまま読む", () => {
    expect(asEngineFailure({ kind: "notUsi", message: "no usiok" })).toEqual({
      kind: "notUsi",
      message: "no usiok",
    });
  });

  test("知らない種類は unknown に落とす", () => {
    expect(asEngineFailure({ kind: "futureKind", message: "x" }).kind).toBe("unknown");
    expect(asEngineFailure({ kind: 3, message: "x" }).kind).toBe("unknown");
  });

  test("形の違う値は unknown で、理由の文字列は残す", () => {
    expect(asEngineFailure("Command start_analysis_engine not found")).toEqual({
      kind: "unknown",
      message: "Command start_analysis_engine not found",
    });
    expect(asEngineFailure(new Error("ipc closed"))).toEqual({
      kind: "unknown",
      message: "ipc closed",
    });
    expect(asEngineFailure(null).kind).toBe("unknown");
  });
});
