import { describe, expect, test } from "vitest";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { kifuOverview } from "../kifuOverview";

/**
 * 棋譜の素性を画面へ出す並び。
 *
 * **ヘッダの欄名を知るのはここと `playerNames` だけ。** 読む側に散らすと、
 * 同じ棋譜について画面ごとに違う答えが出る。
 */
const jkf = (header: Record<string, string>, initial?: JKFData["initial"]): JKFData =>
  ({ header, initial, moves: [{}] }) as JKFData;

const valueOf = (facts: { label: string; value: string }[], label: string) =>
  facts.find((f) => f.label === label)?.value;

describe("kifuOverview", () => {
  test("対局者・棋戦・開始日時は、無くても行を残す", () => {
    const facts = kifuOverview(jkf({}));

    // 欠けていること自体が手掛かり。行ごと消すと、貼った棋譜に何が無いのか分からない
    expect(valueOf(facts, "先手")).toBe("—");
    expect(valueOf(facts, "後手")).toBe("—");
    expect(valueOf(facts, "棋戦")).toBe("—");
    expect(valueOf(facts, "開始日時")).toBe("—");
  });

  test("空白だけの欄は無いものとして扱う", () => {
    expect(valueOf(kifuOverview(jkf({ 棋戦: "   " })), "棋戦")).toBe("—");
  });

  test("棋譜が持っている欄は、決め打ちの後ろに続ける", () => {
    const facts = kifuOverview(jkf({ 先手: "渡辺明", 持ち時間: "各9時間", 戦型: "角換わり" }));

    expect(valueOf(facts, "持ち時間")).toBe("各9時間");
    expect(valueOf(facts, "戦型")).toBe("角換わり");
    // 決め打ちの欄が後ろにも重複しない
    expect(facts.filter((f) => f.label === "先手")).toHaveLength(1);
  });

  test("アプリが書いた持ち物は出さない", () => {
    // `note` と `tags` は `createInitialJKFData` が書く欄で、棋譜の素性ではない
    const facts = kifuOverview(jkf({ note: "自分用メモ", tags: "角換わり,研究" }));

    expect(facts.map((f) => f.label)).not.toContain("note");
    expect(facts.map((f) => f.label)).not.toContain("tags");
  });

  test("初期局面は `initial` から名乗る。ヘッダの文字列を信じない", () => {
    // 「手合割：平手」と書かれた駒落ちの棋譜が作れるので、局面の側を見る
    const facts = kifuOverview(jkf({ 手合割: "平手" }, { preset: "KY" }));

    expect(valueOf(facts, "手合割")).toBe("香落ち");
  });

  test("`initial` が無ければ平手（JKF の既定）", () => {
    expect(valueOf(kifuOverview(jkf({})), "手合割")).toBe("平手");
  });

  test("手合割として選ばせていない綴りは、局面そのものとして名乗る", () => {
    const facts = kifuOverview(jkf({}, { preset: "OTHER", data: undefined }));

    expect(valueOf(facts, "手合割")).toBe("この棋譜の局面");
  });
});
