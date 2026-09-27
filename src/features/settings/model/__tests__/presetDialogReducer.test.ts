import { describe, expect, test } from "vitest";

import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";
import {
  initialPresetDialogState,
  presetDialogReducer,
  type PresetDialogAction,
  type PresetDialogState,
} from "../presetDialogReducer";

/** 判定表は `docs/state-transitions/engine-preset-dialog.md`。セルごとに1本 */

const PRESET: EnginePreset = {
  id: "p1" as PresetId,
  label: "",
  aiName: "",
  enginePath: "/e/a",
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: { NetworkDelay: "120", Threads: "999" },
};

const OUTCOME = (token: number, enginePath = "/e/a"): ProbeOutcome => ({
  token,
  enginePath,
  name: "A",
  author: "x",
  definitions: [{ name: "Threads", type: "spin", default: 4, min: 1, max: 512 }],
  reserved: [],
});

const run = (state: PresetDialogState, ...actions: PresetDialogAction[]) =>
  actions.reduce(presetDialogReducer, state);

const opened = run(initialPresetDialogState, { type: "opened", preset: PRESET });
const probing = run(opened, { type: "probeStarted", token: 1, enginePath: "/e/a" });

describe("P0（取得なし）", () => {
  test("O: 下書きと当てる元の値をプリセットから作り、一覧を消す", () => {
    const withNote = { ...opened, fitNote: { enginePath: "/e/a", clamped: [], dropped: [] } };
    const next = run(withNote, { type: "opened", preset: PRESET });
    expect(next.draft).toBe(PRESET);
    expect(next.baseline).toEqual(PRESET.options);
    expect(next.fitNote).toBeNull();
  });

  test("E: 値以外の欄を直す（更新関数も受ける）", () => {
    const next = run(opened, {
      type: "edited",
      update: (cur) => (cur ? { ...cur, label: "x" } : cur),
    });
    expect(next.draft?.label).toBe("x");
  });

  test("V: 下書きと当てる元の値の両方に重ねる。null で消す", () => {
    const next = run(
      opened,
      { type: "optionSet", name: "MultiPV", value: "3" },
      { type: "optionSet", name: "NetworkDelay", value: null },
    );
    expect(next.draft?.options).toEqual({ Threads: "999", MultiPV: "3" });
    expect(next.baseline).toEqual({ Threads: "999", MultiPV: "3" });
  });

  test("C: 値を全部消す", () => {
    const next = run(opened, { type: "optionsCleared" });
    expect(next.draft?.options).toEqual({});
    expect(next.baseline).toEqual({});
  });

  test("S: 取得中にし、前の失敗を消す", () => {
    const failed = {
      ...opened,
      probeFailure: { kind: "notUsi" as const, message: "", enginePath: "/e/a" },
    };
    const next = run(failed, { type: "probeStarted", token: 1, enginePath: "/e/a" });
    expect(next.probe).toEqual({ token: 1, enginePath: "/e/a" });
    expect(next.probeFailure).toBeNull();
  });

  test("R2 / F2: 待っていない取得の結果と失敗は捨てる", () => {
    expect(
      run(opened, { type: "probeSucceeded", token: 9, outcome: OUTCOME(9), probedAt: "t" }),
    ).toBe(opened);
    expect(
      run(opened, { type: "probeFailed", token: 9, failure: { kind: "notUsi", message: "" } }),
    ).toBe(opened);
  });
});

describe("P1（取得中）", () => {
  test("O: 下書きを作り直しても取得中のまま（下ろすと取得中に保存が開く）", () => {
    const next = run(probing, { type: "opened", preset: { ...PRESET } });
    expect(next.probe).not.toBeNull();
  });

  test("S: 前の取得を置き換える。前の取得の結果は捨てる", () => {
    const next = run(probing, { type: "probeStarted", token: 2, enginePath: "/e/a" });
    expect(
      run(next, { type: "probeSucceeded", token: 1, outcome: OUTCOME(1), probedAt: "t" }),
    ).toBe(next);
  });

  test("R1: 当てる元の値を定義に当て、定義と一緒に下書きへ。一覧を持つ", () => {
    const next = run(probing, {
      type: "probeSucceeded",
      token: 1,
      outcome: OUTCOME(1),
      probedAt: "t",
    });
    expect(next.probe).toBeNull();
    expect(next.draft?.options).toEqual({ Threads: "512" });
    expect(next.draft?.definitionsFor).toBe("/e/a");
    expect(next.fitNote?.dropped.map((d) => d.name)).toEqual(["NetworkDelay"]);
    expect(next.fitNote?.clamped.map((c) => c.name)).toEqual(["Threads"]);
  });

  /** 当てた後の下書きから当て直すと、取り直したときに一覧が空になる */
  test("R1 を2回: 2回目も当てる元の値から当てる（一覧が消えない）", () => {
    const once = run(probing, {
      type: "probeSucceeded",
      token: 1,
      outcome: OUTCOME(1),
      probedAt: "t",
    });
    const twice = run(
      once,
      { type: "probeStarted", token: 2, enginePath: "/e/a" },
      { type: "probeSucceeded", token: 2, outcome: OUTCOME(2), probedAt: "t" },
    );
    expect(twice.fitNote?.dropped.map((d) => d.name)).toEqual(["NetworkDelay"]);
  });

  test("R1（手動のパス欄でパスが変わっていた）: 下書きは触らない", () => {
    const moved = run(probing, {
      type: "edited",
      update: (cur) => (cur ? { ...cur, enginePath: "/elsewhere" } : cur),
    });
    const next = run(moved, {
      type: "probeSucceeded",
      token: 1,
      outcome: OUTCOME(1),
      probedAt: "t",
    });
    expect(next.draft).toBe(moved.draft);
    expect(next.probe).toBeNull();
  });

  test("F1: 失敗を取得したエンジンのパスと一緒に持ち、取得中を下ろす", () => {
    const next = run(probing, {
      type: "probeFailed",
      token: 1,
      failure: { kind: "notUsi", message: "m" },
    });
    expect(next.probe).toBeNull();
    expect(next.probeFailure).toEqual({ kind: "notUsi", message: "m", enginePath: "/e/a" });
  });

  test("A: 取得中を下ろし、後から返った結果は捨てる", () => {
    const next = run(probing, { type: "probeAbandoned" });
    expect(next.probe).toBeNull();
    expect(
      run(next, { type: "probeSucceeded", token: 1, outcome: OUTCOME(1), probedAt: "t" }),
    ).toBe(next);
  });
});
