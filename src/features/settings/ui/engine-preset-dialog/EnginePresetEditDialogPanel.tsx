import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { classifyEnginesDir } from "@/entities/engine/lib/enginesDir";
import "./EnginePresetEditDialogPanel.scss";

import Modal from "@/shared/ui/Modal";

import { autofillPreset, clampInt } from "@/features/settings/lib/presetDialog";
import { getBaseName } from "@/shared/lib/path";
import PresetDialogFooter from "./PresetDialogFooter";
import UsedFilesSection from "./sections/UsedFilesSection";
import AnalysisSection from "./sections/AnalysisSection";
import EngineSettingsSection from "./sections/EngineSettingsSection";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import { useAiRootIndex } from "@/features/settings/model/useAiRootIndex";
import { bookInUse, type EnginePreset, type PresetId } from "@/entities/engine-presets/model/types";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { multiPvMax } from "@/features/settings/lib/presetOptionValues";
import { presetEngineOptions } from "@/features/settings/lib/presetEngineOptions";
import { asStartFailure } from "@/entities/engine";
import { probeEngine } from "@/entities/engine/api/tauri";
import { probePathOf, storedDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import {
  initialPresetDialogState,
  presetDialogReducer,
} from "@/features/settings/model/presetDialogReducer";
import PresetDialogHeader from "./PresetDialogHeader";

type Props = {
  presetId: PresetId;
  onClose: () => void;
};

export default function EnginePresetEditDialogPanel({ presetId, onClose }: Props) {
  const { state, updatePreset } = useEnginePresets();
  const library = useAiRootIndex();
  const { index, rescan } = library;

  const preset = useMemo(
    () => state.presets.find((p) => p.id === presetId) ?? null,
    [state.presets, presetId],
  );

  useEffect(() => {
    if (!preset) onClose();
  }, [preset, onClose]);

  const engines = useMemo(() => index?.engines ?? [], [index?.engines]);
  const profiles = useMemo(() => index?.profiles ?? [], [index?.profiles]);

  /** 開いてから一度でも読み込んだか。開いたときの読み込みを1回にする。 */
  const openedProbeRef = useRef(false);
  /**
   * 開いてから空欄の補完を済ませたか。
   * 評価関数の空は「指定しない」という選択でもあるので、下書きが変わるたびに補完すると選んだ値を埋め直す。
   */
  const autofilledRef = useRef(false);
  const [dialog, dispatch] = useReducer(presetDialogReducer, initialPresetDialogState);
  const { draft, probeFailure, fitNote } = dialog;
  const probing = dialog.probe !== null;
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** 値以外の欄を直す。 */
  const setDraft = useCallback(
    (update: SetStateAction<EnginePreset | null>) => dispatch({ type: "edited", update }),
    [],
  );

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

  const stopProbe = useCallback(() => dispatch({ type: "probeAbandoned" }), []);

  useEffect(() => {
    if (!preset) return;

    dispatch({ type: "opened", preset: structuredClone(preset) });
    setErrors({});
  }, [preset]);

  const engineOptions = useMemo(() => {
    const opts = presetEngineOptions(engines);

    // 候補に無いパス（engines/ の外、消えた）も選択として残す。落とすと保存したパスが画面から見えなくなる
    const cur = draft?.enginePath.trim();
    if (cur && !opts.some((o) => o.value === cur)) {
      opts.unshift({
        value: cur,
        label: `${getBaseName(cur)}（現在の選択）`,
        disabled: false,
        note: null,
      });
    }

    return opts;
  }, [engines, draft?.enginePath]);

  // 候補が揃った時点で1回だけ、エンジンがまだ無いプリセットの空欄を埋める。
  // エンジンのあるプリセットの評価関数の空は、利用者が選んだ「指定しない」なので埋めない
  useEffect(() => {
    if (!draft) return;
    if (!index) return;
    if (autofilledRef.current) return;
    autofilledRef.current = true;
    if (draft.enginePath.trim()) return;

    setDraft((cur) =>
      cur
        ? autofillPreset(cur, {
            profiles,
            engines,
          })
        : cur,
    );
  }, [draft, index, profiles, engines, setDraft]);

  // 開いたときに1回、エンジンを読み込む。画面の名前は保存しないので、毎回いまの辞書から取る。
  // 空欄の補完でエンジンが埋まった回も読み込み、利用者が先に選んでいれば `runProbe` が印を立てている
  useEffect(() => {
    if (openedProbeRef.current || !draft?.enginePath) return;
    runProbe(draft.enginePath);
  }, [draft?.enginePath, runProbe]);

  const setOption = useCallback(
    (name: string, value: string | null) => dispatch({ type: "optionSet", name, value }),
    [],
  );
  const clearOptions = useCallback(
    (names: string[]) => dispatch({ type: "optionsCleared", names }),
    [],
  );

  const onSave = useCallback(async () => {
    if (!draft) return;

    const nextErrors: Record<string, string> = {};

    const label = draft.label.trim();
    const aiName = draft.aiName.trim();
    const enginePath = draft.enginePath.trim();
    const evalFilePath = draft.evalFilePath.trim();

    // 評価関数は必須にしない。指定できないエンジンがある
    if (!label) nextErrors.label = "名前を入力してください";
    if (!enginePath) nextErrors.enginePath = "エンジンを選択してください";

    // 前の版は使わない定跡のパスを残して保存している。落とせば、欄の「使わない」とファイルが揃う
    const bookEnabled = bookInUse(draft);
    const bookFilePath = bookEnabled ? (draft.bookFilePath ?? "").trim() : null;

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const a = draft.analysis ?? { mateSearch: false };
    const timeSeconds = a.timeSeconds != null ? clampInt(a.timeSeconds, 0, 3600) : undefined;
    const depth = a.depth != null ? clampInt(a.depth, 0, 999) : undefined;
    const nodes = a.nodes != null ? clampInt(a.nodes, 0, 999_999_999) : undefined;

    const analysis =
      (timeSeconds && timeSeconds > 0) ||
      (depth && depth > 0) ||
      (nodes && nodes > 0) ||
      a.mateSearch
        ? {
            timeSeconds: timeSeconds && timeSeconds > 0 ? timeSeconds : undefined,
            depth: depth && depth > 0 ? depth : undefined,
            nodes: nodes && nodes > 0 ? nodes : undefined,
            mateSearch: a.mateSearch,
          }
        : undefined;

    // 空は入れない。無い名前はエンジン既定で、送らない
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft.options)) {
      const vv = v.trim();
      if (!vv) continue;
      options[k] = vv;
    }

    const patch: Partial<EnginePreset> = {
      label,
      aiName,
      enginePath,
      evalFilePath,
      bookEnabled,
      bookFilePath,
      options,
      analysis,
      definitions: storedDefinitions(draft.definitions),
      reservedNames: draft.reservedNames ?? null,
      definitionsFor: draft.definitionsFor ?? null,
      probedAt: draft.probedAt ?? null,
      engineName: draft.engineName ?? null,
      engineAuthor: draft.engineAuthor ?? null,
    };

    // 書けなかったら閉じずに入力を残す。理由は `PresetsFileBridge` の帯が出す
    if (await updatePreset(presetId, patch)) onClose();
  }, [draft, onClose, presetId, updatePreset]);

  if (!preset || !draft) return null;

  const title = draft.label.trim() || "プリセット編集";

  return (
    <Modal
      onClose={onClose}
      label={title}
      size="lg"
      variant="dialog"
      scroll="none"
      closeOnEsc={true}
      closeOnOverlay={true}
      showCloseButton={true}
    >
      <div className="presetDialog">
        <PresetDialogHeader title={title} />

        <div className="presetDialog__body">
          <SSection title="名前">
            <SField error={errors.label}>
              <SInput
                value={draft.label}
                aria-label="プリセットの名前"
                placeholder="例: 研究用 / 速い検討 / 定跡整備"
                onChange={(e) => {
                  setDraft({ ...draft, label: e.target.value });
                  setErrors((es) => ({ ...es, label: "" }));
                }}
                invalid={!!errors.label}
              />
            </SField>
          </SSection>

          {library.scan.status === "error" && (
            <div className="presetDialog__hintWarn">{library.scan.error}</div>
          )}

          <UsedFilesSection
            draft={draft}
            enginePathError={errors.enginePath}
            aiRootReady={library.hasRoot}
            scanReady={library.scan.status === "ready" && index != null}
            indexStatus={library.scan.status}
            enginesDir={classifyEnginesDir(index?.engines_dir)}
            enginesDirPath={index?.engines_dir?.path ?? ""}
            onCreateEnginesDir={library.createEnginesDir}
            rescan={rescan}
            engineOptions={engineOptions}
            profiles={profiles}
            onEngineChosen={(path) => {
              // 名乗りを残すと、読み込めなかった別のエンジンを前の名乗りで出す
              setDraft({ ...draft, enginePath: path, engineName: null, engineAuthor: null });
              setErrors((es) => ({ ...es, enginePath: "" }));
              runProbe(path);
            }}
            onEvalChosen={(path, folder) =>
              setDraft({
                ...draft,
                evalFilePath: path,
                aiName: path === "" ? "" : (folder ?? draft.aiName),
              })
            }
            onBookChosen={(path) =>
              setDraft({ ...draft, bookEnabled: path != null, bookFilePath: path })
            }
            onRetry={() => runProbe(draft.enginePath)}
            onStop={stopProbe}
            probing={probing}
            probeFailure={probeFailure}
          />

          <AnalysisSection
            draft={draft}
            setDraft={setDraft}
            setOption={setOption}
            multiPvMax={multiPvMax(draft)}
          />

          <EngineSettingsSection
            draft={draft}
            setOption={setOption}
            clearOptions={clearOptions}
            probing={probing}
            fitNote={fitNote}
          />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={onSave} saveDisabled={probing} />
      </div>
    </Modal>
  );
}
