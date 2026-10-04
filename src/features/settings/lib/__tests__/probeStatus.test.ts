import { describe, expect, test } from "vitest";

import type { EngineStartFailureKind } from "@/entities/engine";
import { probeStatusText, type ProbeFailure } from "../probeStatus";

/** いまのエンジンの定義を読み込めている下書き */
const DRAFT = { enginePath: "/e/a", definitions: [], definitionsFor: "/e/a", reservedNames: [] };
const failure = (kind: EngineStartFailureKind, enginePath = "/e/a"): ProbeFailure => ({
  kind,
  message: "Permission denied",
  enginePath,
});
const ALL_KINDS: EngineStartFailureKind[] = [
  "spawnFailed",
  "quarantined",
  "notUsi",
  "exitedEarly",
  "timedOut",
  "invalidValue",
  "cancelled",
  "other",
  "unknown",
];

describe("probeStatusText", () => {
  /** 読み込みはエンジンを選べば裏で進むもの。うまくいっているときは何も言わない */
  test("読み込めていれば何も出さない。エンジンが無ければ何も出さない", () => {
    expect(probeStatusText(DRAFT, false, null)).toBeNull();
    expect(probeStatusText({ enginePath: "" }, true, null)).toBeNull();
    expect(probeStatusText({ enginePath: "" }, false, null)).toBeNull();
  });

  /** 「やめる」の後など。黙ると、同じエンジンは選び直しても読まれないので、読み込み直す口が消える */
  test("いまのエンジンの定義が無いまま止まっていたら、まだ読み込んでいないと言う", () => {
    const unloaded = probeStatusText({ enginePath: "/e/a" }, false, null);
    expect(unloaded).toEqual({
      tone: "muted",
      text: "エンジンをまだ読み込んでいません。",
      detail: null,
    });
    // 別のエンジンの定義は、いまのエンジンの定義ではない
    expect(probeStatusText({ ...DRAFT, enginePath: "/e/b" }, false, null)?.tone).toBe("muted");
  });

  test("読み込み中", () => {
    expect(probeStatusText(DRAFT, true, null)?.text).toBe("エンジンを読み込んでいます…");
  });

  test("失敗は、失敗したパスがいまのパスのときだけ出す", () => {
    const shown = probeStatusText(DRAFT, false, failure("spawnFailed"));
    expect(shown?.tone).toBe("warn");
    expect(shown?.detail).toBe("Permission denied");
    expect(
      probeStatusText({ ...DRAFT, enginePath: "/e/b" }, false, failure("spawnFailed"))?.tone,
    ).not.toBe("warn");
  });

  test("手で打ったパスの前後の空白は見ない", () => {
    expect(
      probeStatusText({ ...DRAFT, enginePath: " /e/a " }, false, failure("notUsi"))?.tone,
    ).toBe("warn");
  });

  /** 理由だけを言って止まらない。どの種類も、次にすること（もう一度読み込む）を言う */
  test.each(ALL_KINDS)("失敗（%s）は次にすることを言う", (kind) => {
    expect(probeStatusText(DRAFT, false, failure(kind))?.text).toContain(
      "「もう一度読み込む」を押してください",
    );
  });
});
