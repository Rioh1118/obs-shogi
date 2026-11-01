import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { asStartFailure } from "@/entities/engine";
import type { AiRootIndex } from "@/entities/engine/api/aiLibrary";
import { probeEngine } from "@/entities/engine/api/tauri";
import { probePathOf } from "@/entities/engine-presets/lib/withDefinitions";
import type { AnalysisDefaults, PresetId } from "@/entities/engine-presets/model/types";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { autofillPreset } from "@/features/settings/lib/autofillPreset";
import {
  presetFieldErrors,
  presetPatchOf,
  type PresetFieldErrors,
} from "@/features/settings/lib/presetPatch";
import {
  initialPresetDialogState,
  presetDialogReducer,
} from "@/features/settings/model/presetDialogReducer";

type Params = {
  presetId: PresetId;
  /** 候補の索引。読めていなければ `null` */
  index: AiRootIndex | null;
  onClose: () => void;
};

/** プリセット編集の下書きと、エンジンの読み込みと、保存を持つ。 */
export function usePresetDialog({ presetId, index, onClose }: Params) {
  const { state, updatePreset } = useEnginePresets();
  const preset = state.presets.find((p) => p.id === presetId) ?? null;

  const [dialog, dispatch] = useReducer(presetDialogReducer, initialPresetDialogState);
  const { draft } = dialog;
  const [errors, setErrors] = useState<PresetFieldErrors>({});

  /** 開いてから一度でも読み込んだか。開いたときの読み込みを1回にする。 */
  const openedProbeRef = useRef(false);
  /**
   * 開いてから空欄の補完を済ませたか。
   * 評価関数の空は「指定しない」という選択でもあるので、下書きが変わるたびに補完すると選んだ値を埋め直す。
   */
  const autofilledRef = useRef(false);

  /** `rawPath` のエンジンの申告を取る。結果を使うかは reducer が `token` で決める。 */
  const runProbe = useCallback((rawPath: string) => {
    const enginePath = probePathOf(rawPath);
    if (!enginePath) return;
    openedProbeRef.current = true;
    const { token, outcome } = probeEngine(enginePath);
    dispatch({ type: "probeStarted", token, enginePath });
    outcome.then(
      (result) =>
        dispatch({
          type: "probeSucceeded",
          token,
          outcome: result,
          probedAt: new Date().toISOString(),
        }),
      (e: unknown) => {
        const failure = asStartFailure(e);
        console.warn("[EnginePresetEditDialog] probe failed:", failure.message);
        dispatch({
          type: "probeFailed",
          token,
          failure: { kind: failure.kind, message: failure.message },
        });
      },
    );
  }, []);

  const setLabel = (label: string) => {
    dispatch({ type: "edited", update: (cur) => ({ ...cur, label }) });
    setErrors((es) => ({ ...es, label: undefined }));
  };

  const chooseEngine = (enginePath: string) => {
    // 名乗りを残すと、読み込めなかった別のエンジンを前の名乗りで出す
    dispatch({
      type: "edited",
      update: (cur) => ({ ...cur, enginePath, engineName: null, engineAuthor: null }),
    });
    setErrors((es) => ({ ...es, enginePath: undefined }));
    runProbe(enginePath);
  };

  const chooseEval = (path: string, folder: string | null) =>
    dispatch({
      type: "edited",
      update: (cur) => ({
        ...cur,
        evalFilePath: path,
        aiName: path === "" ? "" : (folder ?? cur.aiName),
      }),
    });

  const chooseBook = (path: string | null) =>
    dispatch({
      type: "edited",
      update: (cur) => ({ ...cur, bookEnabled: path != null, bookFilePath: path }),
    });

  const setAnalysis = (patch: Partial<AnalysisDefaults>) =>
    dispatch({
      type: "edited",
      update: (cur) => ({
        ...cur,
        analysis: { ...(cur.analysis ?? { mateSearch: false }), ...patch },
      }),
    });

  const setOption = (name: string, value: string | null) =>
    dispatch({ type: "optionSet", name, value });

  const clearOptions = (names: string[]) => dispatch({ type: "optionsCleared", names });

  const retryProbe = () => {
    if (draft) runProbe(draft.enginePath);
  };

  const stopProbe = () => dispatch({ type: "probeAbandoned" });

  const save = async () => {
    if (!draft) return;
    const fieldErrors = presetFieldErrors(draft);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    // 書けなかったら閉じずに入力を残す。理由は `PresetsFileBridge` の帯が出す
    if (await updatePreset(presetId, presetPatchOf(draft))) onClose();
  };

  useEffect(() => {
    if (!preset) onClose();
  }, [preset, onClose]);

  useEffect(() => {
    if (!preset) return;
    dispatch({ type: "opened", preset: structuredClone(preset) });
    setErrors({});
  }, [preset]);

  // 候補が揃った時点で1回だけ、エンジンがまだ無いプリセットの空欄を埋める。
  // エンジンのあるプリセットの評価関数の空は、利用者が選んだ「指定しない」なので埋めない
  useEffect(() => {
    if (!draft || !index || autofilledRef.current) return;
    autofilledRef.current = true;
    if (draft.enginePath.trim()) return;
    dispatch({ type: "edited", update: (cur) => autofillPreset(cur, index) });
  }, [draft, index]);

  // 開いたときに1回、エンジンを読み込む。画面の名前は保存しないので、毎回いまの辞書から取る。
  // 空欄の補完でエンジンが埋まった回も読み込み、利用者が先に選んでいれば `runProbe` が印を立てている
  useEffect(() => {
    if (openedProbeRef.current || !draft?.enginePath) return;
    runProbe(draft.enginePath);
  }, [draft?.enginePath, runProbe]);

  return {
    draft: preset ? draft : null,
    errors,
    probing: dialog.probe !== null,
    probeFailure: dialog.probeFailure,
    fitNote: dialog.fitNote,
    setLabel,
    chooseEngine,
    chooseEval,
    chooseBook,
    setAnalysis,
    setOption,
    clearOptions,
    retryProbe,
    stopProbe,
    save,
  };
}
