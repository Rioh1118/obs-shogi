import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { fitValues } from "../fitValues";

/**
 * 画面が利用者の値を定義に当てる規則（`fitValues`）は、**送る側（Rust の `binding::user_value`）と
 * 同じ表を当てる。** 表は Rust の `user_values_follow_the_shared_fit_table` も読む。
 *
 * ずれると、画面で残した値が起動のたびに捨てられる・丸められる（保存の前に見せた「外した・丸めた」が
 * 嘘になる）。落ちたら、**表を直す前にどちらの規則が正しいかを決め、両方を合わせる**
 */
type Case = {
  line: string;
  def: UsiOptionDef;
  value: string;
  expect: { sent: string } | { clamped: string } | { dropped: string };
};
const CASES: Case[] = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../src-tauri/tests/fixtures/option_fit_cases.json"),
    "utf8",
  ),
);

describe("fitValues は Rust と同じ表で当てる", () => {
  test("表が読める", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10);
  });

  test.each(CASES.map((c) => [`${c.line} に ${JSON.stringify(c.value)}`, c] as const))(
    "%s",
    (_, c) => {
      const fitted = fitValues({ [c.def.name]: c.value }, [c.def], []);
      const got =
        fitted.dropped.length > 0
          ? { dropped: fitted.dropped[0].reason }
          : fitted.clamped.length > 0
            ? { clamped: fitted.clamped[0].value }
            : { sent: fitted.options[c.def.name] };
      expect(got).toEqual(c.expect);
    },
  );
});
