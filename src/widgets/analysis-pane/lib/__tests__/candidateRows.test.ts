import { describe, expect, test } from "vitest";
import type { AnalysisCandidate } from "@/entities/engine";
import { MULTIPV_MAX } from "@/features/settings/lib/presetDialog";
import { buildCandidateRows, formatDelta, MAX_VISIBLE_CANDIDATES } from "../candidateRows";

const cp = (value: number) => ({ value, kind: "Centipawn" as const });
const mate = (n: number) => ({ value: 0, kind: { MateInMoves: n } });

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

  // 手番視点なので常に 0 以下。先手視点に揃えたあとで引くと後手番で符号が反転する
  test("Δ は最善手との差で、最善手は 0", () => {
    const raw = [candidate(1, cp(52)), candidate(2, cp(31)), candidate(3, cp(-8))];

    const rows = buildCandidateRows(raw, noMoves(3), [null, null, null]);

    expect(rows.map((r) => r.delta)).toEqual([0, -21, -60]);
  });

  test("詰みが混ざる組では Δ を出さない", () => {
    const raw = [candidate(1, mate(3)), candidate(2, cp(120))];

    const rows = buildCandidateRows(raw, noMoves(2), [null, null]);

    expect(rows.map((r) => r.delta)).toEqual([null, null]);
  });

  test("評価値が無い候補では Δ を出さない", () => {
    const raw = [candidate(1, cp(52)), candidate(2, null)];

    const rows = buildCandidateRows(raw, noMoves(2), [null, null]);

    expect(rows[1].delta).toBeNull();
  });

  test("候補が無ければ行も無い", () => {
    expect(buildCandidateRows([], [], [])).toEqual([]);
  });
});

describe("Δ の表示", () => {
  test("0 は ±0、引けなければ —", () => {
    expect(formatDelta(0)).toBe("±0");
    expect(formatDelta(-21)).toBe("-21");
    expect(formatDelta(null)).toBe("—");
  });
});
