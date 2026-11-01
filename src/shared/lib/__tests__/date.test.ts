import { describe, expect, it } from "vitest";
import { formatDate, formatShortDate } from "../date";

describe("日付の表記", () => {
  const iso = new Date(2025, 2, 21, 9, 5).toISOString();

  it("年月日を0で埋めて書く", () => {
    expect(formatDate(iso)).toBe("2025-03-21");
  });

  it("短い形は月日だけを書く", () => {
    expect(formatShortDate(iso)).toBe("3/21");
  });

  it("読めない日時は空を返す", () => {
    expect(formatDate("不明")).toBe("");
    expect(formatShortDate("不明")).toBe("");
  });
});
