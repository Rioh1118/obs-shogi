import { describe, expect, test } from "vitest";
import { playerNames } from "../playerNames";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * **欄名と「欠けている」の判定を1箇所に持つ。**
 *
 * 読む側に散らすと、同じ棋譜について画面ごとに違う答えが出る。実際に
 * 空白だけの欄をヘッダは「無い」、盤は「空文字」として扱っていて、
 * 片方は「先手」、もう片方は `—` を出していた。
 */
describe("playerNames", () => {
  const of = (header: Record<string, string>) => ({ header, moves: [{}] }) as unknown as JKFData;

  test("両方の名前を返す", () => {
    expect(playerNames(of({ 先手: "藤井", 後手: "羽生" }))).toEqual({
      sente: "藤井",
      gote: "羽生",
    });
  });

  test("前後の空白は落とす", () => {
    expect(playerNames(of({ 先手: "  藤井  " })).sente).toBe("藤井");
  });

  /** **これが2箇所で答えの割れていた入力。** 空白だけなら「無い」 */
  test("空白だけの欄は無いものとして扱う", () => {
    expect(playerNames(of({ 先手: "   ", 後手: "" }))).toEqual({ sente: null, gote: null });
  });

  test("欄が無ければ null", () => {
    expect(playerNames(of({}))).toEqual({ sente: null, gote: null });
  });

  test("棋譜が無ければ null", () => {
    expect(playerNames(null)).toEqual({ sente: null, gote: null });
  });
});
