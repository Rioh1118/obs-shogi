import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { commitSpinInput } from "../spinInput";

type Case = {
  def: UsiOptionDef;
  value: string;
  expect: { sent: string } | { clamped: string } | { dropped: string };
};
const SPIN_CASES = (
  JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../../../src-tauri/tests/fixtures/option_fit_cases.json"),
      "utf8",
    ),
  ) as Case[]
).filter(
  (c): c is Case & { def: Extract<UsiOptionDef, { type: "spin" }> } => c.def.type === "spin",
);

/**
 * 欄が確定する値は、送る側と同じ表（`option_fit_cases.json` の spin の行）に従う。
 * 送る側が受ける値を欄が別の値に書き換えない
 */
describe("commitSpinInput は送る側と同じ表で確定する", () => {
  test("表に spin の行がある", () => {
    expect(SPIN_CASES.length).toBeGreaterThanOrEqual(5);
  });

  test.each(SPIN_CASES.map((c) => [`${c.def.name} に ${JSON.stringify(c.value)}`, c] as const))(
    "%s",
    (_, c) => {
      const got = commitSpinInput(c.def, null, c.value);
      if ("dropped" in c.expect) expect(got).toBeUndefined();
      else if ("sent" in c.expect) expect(got).toBe(c.expect.sent.trim());
      else expect(got).toBe(c.expect.clamped);
    },
  );
});

describe("commitSpinInput（欄の読み替え）", () => {
  const def = { name: "USI_Hash", type: "spin" as const, default: 16, min: 1, max: 4096 };

  test("全角数字と桁区切りを読む", () => {
    expect(commitSpinInput(def, null, "１，０２４")).toBe("1024");
  });

  test("空ならエンジン既定。もともと値が無ければ確定しない", () => {
    expect(commitSpinInput(def, "256", "")).toBeNull();
    expect(commitSpinInput(def, null, " ")).toBeUndefined();
  });

  /** 確定すると当てる元の値に重なり、別のエンジンで保存済みの値が戻らない */
  test("読めない・保存済みと同じなら確定しない", () => {
    expect(commitSpinInput(def, "4096", "abc")).toBeUndefined();
    expect(commitSpinInput(def, "4096", "99999")).toBeUndefined();
  });
});
