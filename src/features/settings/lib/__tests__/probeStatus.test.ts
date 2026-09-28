import { describe, expect, test } from "vitest";

import type { EngineStartFailureKind } from "@/entities/engine";
import { probeStatusText, type ProbeFailure } from "../probeStatus";

const BASE = {
  enginePath: "/e/a",
  definitions: null,
  definitionsFor: null,
  reservedNames: null,
  engineName: null,
  probedAt: null,
};
const PROBED = {
  ...BASE,
  definitions: [{ name: "Threads", type: "spin" as const, default: 4, min: 1, max: 8 }],
  definitionsFor: "/e/a",
  reservedNames: [],
  engineName: "A",
};
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
  test("エンジンが空なら出さない", () => {
    expect(probeStatusText({ ...BASE, enginePath: "" }, false, null)).toBeNull();
  });

  test("取ったエンジンの定義なら件数と名前", () => {
    expect(probeStatusText(PROBED, false, null)?.text).toBe("オプション 1 件を取得済み（A）");
  });

  // 選び直すと前のエンジンの定義が下書きに残る。件数だけを見ると別のエンジンの定義を言う
  test("別のエンジンの定義は未取得として扱う", () => {
    expect(probeStatusText({ ...PROBED, enginePath: "/e/b" }, false, null)?.text).toBe(
      "オプションは未取得です",
    );
  });

  // 保存は前後の空白を落とす。取った側だけ空白つきだと、保存し直した後に「未取得」になる
  test("手で打ったパスの前後の空白は見ない", () => {
    expect(probeStatusText({ ...PROBED, enginePath: " /e/a " }, false, null)?.text).toContain(
      "取得済み",
    );
  });

  test("失敗は、失敗したパスがいまのパスのときだけ出す", () => {
    const shown = probeStatusText(BASE, false, failure("spawnFailed"));
    expect(shown?.tone).toBe("warn");
    expect(shown?.detail).toBe("Permission denied");

    // 打ち換えた後に、前のパスの失敗を出さない
    expect(
      probeStatusText({ ...BASE, enginePath: "/e/b" }, false, failure("spawnFailed"))?.text,
    ).toBe("オプションは未取得です");
  });

  /** 理由だけを言って止まらない。どの種類も、このダイアログの中で次にすることを言う */
  test.each(ALL_KINDS)("失敗（%s）は次にすることを言う", (kind) => {
    const text = probeStatusText(BASE, false, failure(kind))?.text ?? "";
    expect(text).toContain("「オプションを読み込む」を押してください");
  });

  test("取得中", () => {
    expect(probeStatusText(PROBED, true, null)?.text).toBe("オプションを取得中…");
  });

  test("取った日を添える", () => {
    expect(
      probeStatusText({ ...PROBED, probedAt: "2026-09-20T01:02:03Z" }, false, null)?.text,
    ).toBe("オプション 1 件を取得済み（A）。2026-09-20 に取得");
  });

  /** アプリが決める名前を持たずに保存した定義では、その欄が編集できるように見える。取り直させる */
  test("アプリが決める名前の無い定義は未取得として扱う", () => {
    expect(probeStatusText({ ...PROBED, reservedNames: null }, false, null)?.text).toBe(
      "オプションは未取得です",
    );
  });
});
