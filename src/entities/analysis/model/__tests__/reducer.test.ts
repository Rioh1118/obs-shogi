import { describe, expect, it } from "vitest";

import { analysisReducer, initialState } from "../reducer";
import type { AnalysisState } from "../types";

/**
 * 停止が `analyzedSfen` と `candidates` の組を残す。
 *
 * 候補手の控え（`lib/candidateCache.ts`）は両方が同じ解析の組であることを前提に、`AnalysisPane` の
 * 判定で局面を突き合わせて控える。片方だけが落ちると、組が崩れたまま判定を通る。
 * 書き手の場所は `stateFieldWriters` が見るが、残ることはここでしか見ない。
 */
describe("解析の停止が残すもの", () => {
  const analyzing = (): AnalysisState =>
    analysisReducer(
      analysisReducer(initialState, { type: "start_analysis", payload: { sfen: "SFEN-A" } }),
      { type: "update_result", payload: { candidates: [{ rank: 1, pv_line: [] }] } },
    );

  it("解析した局面と候補手を残す", () => {
    const stopped = analysisReducer(analyzing(), { type: "stop_analysis" });

    expect(stopped.isAnalyzing).toBe(false);
    expect(stopped.analyzedSfen).toBe("SFEN-A");
    expect(stopped.candidates).toHaveLength(1);
  });

  it("探索の完了は検討を切らず、次の開始と中断で外れる", () => {
    const last = { candidates: [{ rank: 1, pv_line: ["2g2f"] }] };
    const finished = analysisReducer(analyzing(), { type: "finish_analysis", payload: last });
    expect(finished.finished).toBe(true);
    expect(finished.isAnalyzing).toBe(true);
    expect(finished.candidates).toEqual(last.candidates);

    const next = analysisReducer(finished, { type: "start_analysis", payload: { sfen: "SFEN-B" } });
    expect(next.finished).toBe(false);
    expect(analysisReducer(finished, { type: "stop_analysis" }).finished).toBe(false);
    expect(analysisReducer(finished, { type: "set_error", payload: "x" }).finished).toBe(false);
  });

  it("検討の意思を立てると、読む局面を空ける", () => {
    const stopped = analysisReducer(analyzing(), { type: "stop_analysis" });
    const held = analysisReducer(stopped, { type: "hold_intent" });

    expect(held.isAnalyzing).toBe(true);
    expect(held.analyzedSfen).toBeNull();
  });

  it("▶ を押すと断りを空ける。**同じ文で断られても帯が出直す**", () => {
    const refused = analysisReducer(initialState, { type: "set_error", payload: "断り" });

    const pressed = analysisReducer(refused, { type: "begin_start" });

    expect(pressed.starting).toBe(true);
    expect(pressed.error).toBeNull();
  });

  it("席が返る前の ■ も止め待ちに入る", () => {
    const pressed = analysisReducer(initialState, { type: "begin_start" });

    expect(analysisReducer(pressed, { type: "begin_stop" }).stopping).toBe(true);
  });

  it("エンジンが戻ると断りが消える", () => {
    const refused = analysisReducer(initialState, { type: "set_error", payload: "断り" });

    expect(analysisReducer(refused, { type: "engine_restored" }).error).toBeNull();
  });

  it("検討していないときの完了は何も変えない", () => {
    const last = { candidates: [{ rank: 1, pv_line: [] }] };
    expect(analysisReducer(initialState, { type: "finish_analysis", payload: last })).toBe(
      initialState,
    );
  });

  it("結果を捨てる指示では候補手が消え、解析した局面は残る", () => {
    const cleared = analysisReducer(analyzing(), { type: "clear_results" });

    expect(cleared.candidates).toHaveLength(0);
    expect(cleared.analyzedSfen).toBe("SFEN-A");
  });
});

/**
 * 候補手を rank の昇順に保つ。
 *
 * 行モード（`CandidatesSection`）は最善手を1行目にあることだけで示す。届いた順のまま置くと、
 * エンジンが rank を逆順で送ったときに最善手が画面から読めなくなる。
 */
describe("解析結果の並び", () => {
  it("届いた順によらず rank の昇順に置く", () => {
    const state = analysisReducer(initialState, {
      type: "update_result",
      payload: {
        candidates: [
          { rank: 3, pv_line: [] },
          { rank: 1, pv_line: [] },
          { rank: 2, pv_line: [] },
        ],
      },
    });

    expect(state.candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
  });
});
