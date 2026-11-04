import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";
import type { AnalysisCandidate, Evaluation } from "@/entities/engine";

import { evaluationToPercentage, formatEvaluation } from "../sfenConverter";
import { convertCandidateToSenteView } from "../usi";

/**
 * 評価値の書式と、先手視点への揃え方。
 *
 * エンジンは手番の側から見た値を返す。揃え損ねると、後手番の局面だけ
 * 評価値の符号と評価値バーの向きが逆に出る。
 */

const cp = (value: number): Evaluation => ({ value, kind: "Centipawn" });
const mate = (moves: number): Evaluation => ({ value: 0, kind: { MateInMoves: moves } });
const mateUnknown = (winning: boolean): Evaluation => ({
  value: 0,
  kind: { MateUnknown: winning },
});

describe("評価値の書式", () => {
  test.each([
    [cp(123), "+123"],
    [cp(0), "0"],
    [cp(-45), "-45"],
    [mate(7), "Mate+7"],
    [mate(0), "Mate+0"],
    [mate(-3), "Mate-3"],
    [mateUnknown(true), "Mate+"],
    [mateUnknown(false), "Mate-"],
  ])("%j は %s", (evaluation, text) => {
    expect(formatEvaluation(evaluation)).toBe(text);
  });

  test("評価値が無ければ ---", () => {
    expect(formatEvaluation(null)).toBe("---");
  });
});

describe("評価値バーの位置", () => {
  test.each([
    [cp(0), 50],
    [cp(1500), 75],
    [cp(-1500), 25],
    [cp(3000), 100],
    [cp(5000), 100],
    [cp(-3000), 0],
    [cp(-5000), 0],
    [mate(5), 100],
    [mate(0), 100],
    [mate(-5), 0],
    [mateUnknown(true), 100],
    [mateUnknown(false), 0],
  ])("%j は %d%%", (evaluation, percentage) => {
    expect(evaluationToPercentage(evaluation)).toBe(percentage);
  });

  test("評価値が無ければ中央", () => {
    expect(evaluationToPercentage(null)).toBe(50);
  });
});

describe("先手視点へ揃える", () => {
  const candidate = (evaluation: Evaluation | null): AnalysisCandidate => ({
    rank: 1,
    first_move: "7g7f",
    pv_line: ["7g7f"],
    evaluation,
  });

  test("先手番はそのまま", () => {
    expect(convertCandidateToSenteView(candidate(cp(80)), Color.Black).evaluation).toEqual(cp(80));
  });

  test.each([
    [cp(80), cp(-80)],
    [
      { value: 30, kind: { MateInMoves: 5 } } as Evaluation,
      { value: -30, kind: { MateInMoves: -5 } },
    ],
    [
      { value: 30, kind: { MateUnknown: true } } as Evaluation,
      { value: -30, kind: { MateUnknown: false } },
    ],
  ])("後手番は符号を返す（%j）", (from, to) => {
    expect(convertCandidateToSenteView(candidate(from), Color.White).evaluation).toEqual(to);
  });

  test("評価値の無い候補は、評価値が無いまま", () => {
    expect(convertCandidateToSenteView(candidate(null), Color.White).evaluation).toBeNull();
  });

  test("評価値の他の欄は変えない", () => {
    const converted = convertCandidateToSenteView(candidate(cp(80)), Color.White);

    expect(converted).toMatchObject({ rank: 1, first_move: "7g7f", pv_line: ["7g7f"] });
  });
});
