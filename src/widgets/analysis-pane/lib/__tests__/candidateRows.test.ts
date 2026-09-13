import { describe, expect, test } from "vitest";
import type { AnalysisCandidate } from "@/entities/engine";
import { MULTIPV_MAX } from "@/features/settings/lib/presetDialog";
import { buildCandidateRows, MAX_VISIBLE_CANDIDATES } from "../candidateRows";

const cp = (value: number) => ({ value, kind: "Centipawn" as const });

/** 手番視点のまま渡す候補。読み筋と先手視点の評価値は別に渡す */
const candidate = (rank: number, evaluation: AnalysisCandidate["evaluation"]) =>
  ({ rank, first_move: "7g7f", pv_line: ["7g7f"], evaluation }) satisfies AnalysisCandidate;

const noMoves = (n: number) => Array.from({ length: n }, () => []);

describe("候補手の行", () => {
  test("上限はプリセットが増やせる数と同じ", () => {
    // 独立に決めると、増やしたぶんが黙って捨てられる（#563）
    expect(MAX_VISIBLE_CANDIDATES).toBe(MULTIPV_MAX);
  });

  test("上限を超えた分は落とす", () => {
    const many = Array.from({ length: MULTIPV_MAX + 3 }, (_, i) => candidate(i + 1, cp(0)));

    expect(
      buildCandidateRows(
        many,
        noMoves(many.length),
        many.map(() => null),
      ),
    ).toHaveLength(MULTIPV_MAX);
  });

  test("最善手は `rank` がいちばん小さい行", () => {
    const raw = [candidate(2, cp(31)), candidate(1, cp(52))];

    const rows = buildCandidateRows(raw, noMoves(2), [null, null]);

    expect(rows.map((r) => r.isBest)).toEqual([false, true]);
  });

  test("候補が無ければ行も無い", () => {
    expect(buildCandidateRows([], [], [])).toEqual([]);
  });
});
