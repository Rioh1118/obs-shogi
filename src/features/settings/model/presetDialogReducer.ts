import type { SetStateAction } from "react";

import type { ProbeOutcome } from "@/entities/engine";
import { fitValues } from "@/entities/engine-presets/lib/fitValues";
import { withDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import type { EnginePreset, UsiOptionMap } from "@/entities/engine-presets/model/types";
import type { FitNote } from "@/features/settings/lib/fitNote";
import type { ProbeFailure } from "@/features/settings/lib/probeStatus";

/**
 * プリセット編集ダイアログの、下書きと取得の状態。判定表は
 * `docs/state-transitions/engine-preset-dialog.md`。
 *
 * **1つの reducer に持つ。** 下書き・当てる元の値・取得中・失敗・変えた値の一覧は互いの意味に
 * 依存する（取得の結果を当てるのは「その取得がいまの取得で、下書きのエンジンが取得したエンジン」の
 * ときだけ）。別々の state に持つと、どれか1つだけが古いまま残る形が組める
 */
export type PresetDialogState = {
  draft: EnginePreset | null;
  /**
   * 定義に当てる**元の値**: 開いたときのプリセットの値に、このダイアログで利用者が変えた値を重ねたもの。
   * **当てた後の下書きから当て直さない。** 当て直すと、あるエンジンの定義で外した値が、その値を受ける
   * 別のエンジンを選び直しても戻らなくなる
   */
  baseline: UsiOptionMap;
  /** 進んでいる取得。`null` なら取得していない（やめた回も） */
  probe: { token: number; enginePath: string } | null;
  probeFailure: ProbeFailure | null;
  /** 取得した定義に当てて変えた値。保存の前に見せる */
  fitNote: FitNote | null;
};

export const initialPresetDialogState: PresetDialogState = {
  draft: null,
  baseline: {},
  probe: null,
  probeFailure: null,
  fitNote: null,
};

export type PresetDialogAction =
  /** プリセットから下書きを作る（開いたとき・プリセットが読み直されたとき） */
  | { type: "opened"; preset: EnginePreset }
  /** 値以外の欄の編集（名前・エンジン・評価関数・定跡・解析の既定値。各節の `setDraft`） */
  | { type: "edited"; update: SetStateAction<EnginePreset | null> }
  /** オプションの値を変える。`null` で消す（エンジン既定） */
  | { type: "optionSet"; name: string; value: string | null }
  /**
   * 挙げた名前のオプションの値を消す（エンジン既定に戻す）。エンジンの設定のうち画面に出ている行だけを
   * 渡す——絞り込みで見えていない行や、「解析」の節が持つ候補手の数（`AnalysisSection`）まで消さない
   */
  | { type: "optionsCleared"; names: string[] }
  | { type: "probeStarted"; token: number; enginePath: string }
  | { type: "probeSucceeded"; token: number; outcome: ProbeOutcome; probedAt: string }
  | { type: "probeFailed"; token: number; failure: Omit<ProbeFailure, "enginePath"> }
  /** 待ちをやめる。後から返った結果は `token` が合わずに捨てる */
  | { type: "probeAbandoned" };

function withOption(options: UsiOptionMap, name: string, value: string | null): UsiOptionMap {
  const next = { ...options };
  if (value == null) delete next[name];
  else next[name] = value;
  return next;
}

/** 返った取得が、いま待っている取得か（やめた・撃ち直した後の結果は捨てる） */
function isCurrent(state: PresetDialogState, token: number): boolean {
  return state.probe?.token === token;
}

export function presetDialogReducer(
  state: PresetDialogState,
  action: PresetDialogAction,
): PresetDialogState {
  switch (action.type) {
    case "opened":
      // 下書きを作り直したので、当てる元の値と一覧もそこから始め直す。**取得中の印は残す**——
      // 読み直しで下書きが作り直されても取得は進んでいて、下ろすと取得中に保存が開く
      return {
        ...state,
        draft: action.preset,
        baseline: { ...action.preset.options },
        fitNote: null,
      };

    case "edited": {
      const draft =
        typeof action.update === "function" ? action.update(state.draft) : action.update;
      return draft === state.draft ? state : { ...state, draft };
    }

    case "optionSet":
      if (!state.draft) return state;
      // 利用者が変えた値は、定義に当て直しても残す（当てる元の値にも重ねる）
      return {
        ...state,
        draft: {
          ...state.draft,
          options: withOption(state.draft.options, action.name, action.value),
        },
        baseline: withOption(state.baseline, action.name, action.value),
      };

    case "optionsCleared": {
      if (!state.draft) return state;
      let options = state.draft.options;
      let baseline = state.baseline;
      for (const name of action.names) {
        options = withOption(options, name, null);
        baseline = withOption(baseline, name, null);
      }
      // 当てて変えた値の一覧も消す。消した値について「保存すると確定します」と言い続けない
      return { ...state, draft: { ...state.draft, options }, baseline, fitNote: null };
    }

    case "probeStarted":
      return {
        ...state,
        probe: { token: action.token, enginePath: action.enginePath },
        probeFailure: null,
      };

    case "probeSucceeded": {
      if (!isCurrent(state, action.token)) return state;
      const fitted = fitValues(state.baseline, action.outcome.definitions, action.outcome.reserved);
      const note: FitNote = {
        enginePath: action.outcome.enginePath,
        clamped: fitted.clamped,
        dropped: fitted.dropped,
      };
      const cur = state.draft;
      const withDefs = cur ? withDefinitions(cur, action.outcome, action.probedAt) : cur;
      // 取得を撃たずにパスが変わっていた（`withDefinitions` が同じ参照を返した）なら当てない。
      // 一覧はそのパスには出ない（`fitNoteLines`）
      const draft = withDefs && withDefs !== cur ? { ...withDefs, options: fitted.options } : cur;
      return { ...state, draft, probe: null, fitNote: note };
    }

    case "probeFailed":
      if (!isCurrent(state, action.token) || !state.probe) return state;
      return {
        ...state,
        probe: null,
        probeFailure: { ...action.failure, enginePath: state.probe.enginePath },
      };

    case "probeAbandoned":
      return { ...state, probe: null };
  }
}
