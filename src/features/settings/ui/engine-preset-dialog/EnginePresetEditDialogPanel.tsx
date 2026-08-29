import { useCallback, useEffect, useMemo, useState } from "react";
import "./EnginePresetEditDialogPanel.scss";

import Modal from "@/shared/ui/Modal";

import {
  basename,
  clampInt,
  cleanText,
  deepClone,
  parseIntSafe,
} from "@/features/settings/lib/presetDialog";
import BasicSection from "./sections/BasicSection";
import EngineFilesSection from "./sections/EngineFilesSection";
import UsiOptionsSection from "./sections/UsiOptionsSection";
import AnalysisDefaultsSection from "./sections/AnalysisDefaultsSection";
import PresetDialogFooter from "./PresetDialogFooter";
import { useAppConfig } from "@/entities/app-config";
import type {
  AnalysisDefaults,
  EnginePreset,
  PresetId,
} from "@/entities/engine-presets/model/types";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { DEFAULT_USI_OPTIONS } from "@/entities/engine-presets/model/defaultOptions";
import { filterEnginesByAiLabel, listAiLabels } from "../../lib/engineFilter";
import PresetDialogHeader from "./PresetDialogHeader";
import {
  ensureEnginesDir,
  scanAiRoot,
  type AiRootIndex,
  type EngineCandidate,
} from "@/entities/engine/api/aiLibrary";

type Props = {
  presetId: PresetId;
  open: boolean;
  onClose: () => void;
};

/** Hookなしラッパー：Hookルール的に safe */
export default function EnginePresetEditDialogPanel(props: Props) {
  if (!props.open) return null;
  return <EnginePresetEditDialogInner {...props} />;
}

/** ここから Hook を使う本体 */
function EnginePresetEditDialogInner({ presetId, open, onClose }: Props) {
  const { state, updatePreset } = useEnginePresets();
  const { config, chooseAiRoot } = useAppConfig();

  const preset = useMemo(
    () => state.presets.find((p) => p.id === presetId) ?? null,
    [state.presets, presetId],
  );

  const aiRoot = config?.ai_root ?? null;

  // ---- scan state ----
  const [index, setIndex] = useState<AiRootIndex | null>(null);
  const [indexStatus, setIndexStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);

  const rescan = useCallback(() => setScanNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open) return;
      if (!aiRoot) {
        setIndex(null);
        setIndexStatus("idle");
        setIndexError(null);
        return;
      }

      setIndexStatus("loading");
      setIndexError(null);
      try {
        const idx = await scanAiRoot(aiRoot);
        if (cancelled) return;
        setIndex(idx);
        setIndexStatus("ok");
      } catch (e) {
        if (cancelled) return;
        setIndex(null);
        setIndexStatus("error");
        setIndexError(`AI_ROOT のスキャンに失敗しました: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, aiRoot, scanNonce]);

  // preset が消えたら閉じる
  useEffect(() => {
    if (!open) return;
    if (!preset) onClose();
  }, [open, preset, onClose]);

  // ---- derived candidates ----
  const enginesAll = useMemo(() => index?.engines ?? [], [index?.engines]);
  const profiles = useMemo(() => index?.profiles ?? [], [index?.profiles]);

  // "YaneuraOu*" のみ表示したいなら、ここで最小限フィルタ（parse不要）
  const engines = useMemo(
    () => enginesAll.filter((e: EngineCandidate) => String(e.entry ?? "").startsWith("YaneuraOu_")),
    [enginesAll],
  );

  // ---- draft ----
  const [draft, setDraft] = useState<EnginePreset | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Dialog-only: エンジン絞り込み（保存しない）
  const [engineFilterAi, setEngineFilterAi] = useState("");

  // preset → draft 初期化
  useEffect(() => {
    if (!open) return;
    if (!preset) return;

    setDraft(deepClone(preset));
    setErrors({});
  }, [open, preset]);

  const currentProfile = useMemo(() => {
    const name = cleanText(draft?.aiName ?? "");
    if (!name) return null;
    return profiles.find((p) => p.name === name) ?? null;
  }, [profiles, draft?.aiName]);

  const evalFiles = useMemo(() => {
    const xs = currentProfile?.eval_files ?? [];
    const nn = xs.filter((f) => f.entry === "nn.bin");
    const rest = xs.filter((f) => f.entry !== "nn.bin");
    return [...nn, ...rest];
  }, [currentProfile]);

  const bookDbs = useMemo(() => currentProfile?.book_db_files ?? [], [currentProfile]);

  // ---- engine filter ----
  const engineFilterOptions = useMemo(() => {
    const labels = listAiLabels();
    return [
      { value: "", label: "（絞り込みなし）" },
      ...labels.map((x) => ({ value: x, label: x })),
    ];
  }, []);

  const engineFiltered = useMemo(() => {
    return filterEnginesByAiLabel(engines, engineFilterAi);
  }, [engines, engineFilterAi]);

  const engineOptions = useMemo(() => {
    const filtered = engineFiltered.filtered;

    const opts = filtered.map((e) => ({
      value: e.path,
      label: e.entry,
      disabled: !(e.kind === "file" || e.kind === "symlink"),
    }));

    // フィルタ外の現在選択を落とさない（UI壊れ防止）
    const cur = cleanText(draft?.enginePath ?? "");
    if (cur && !filtered.some((e) => e.path === cur)) {
      opts.unshift({
        value: cur,
        label: `${basename(cur)}（現在の選択）`,
        disabled: false,
      });
    }

    return opts;
  }, [engineFiltered.filtered, draft?.enginePath]);

  const evalOptions = useMemo(
    () =>
      evalFiles.map((f) => ({
        value: f.path,
        label: f.entry,
        disabled: !(f.kind === "file" || f.kind === "symlink"),
      })),
    [evalFiles],
  );

  const bookOptions = useMemo(
    () =>
      bookDbs.map((f) => ({
        value: f.path,
        label: f.entry,
        disabled: !(f.kind === "file" || f.kind === "symlink"),
      })),
    [bookDbs],
  );

  const scanReady = indexStatus === "ok" && index != null;

  // ---- index available → “空欄だけ” 最小オートフィル ----
  useEffect(() => {
    if (!open) return;
    if (!draft) return;
    if (!index) return;

    setDraft((cur) => {
      if (!cur) return cur;

      const next = { ...cur };

      // profile empty -> pick first eval-capable
      if (!cleanText(next.aiName)) {
        const p = profiles.find((x) => x.has_eval_dir) ?? profiles[0] ?? null;
        if (p) next.aiName = p.name;
      }

      const prof = profiles.find((p) => p.name === cleanText(next.aiName)) ?? null;

      // engine empty -> pick first from filtered (or all)
      if (!cleanText(next.enginePath)) {
        const first = engineFiltered.filtered[0] ?? engines[0] ?? null;
        if (first) next.enginePath = first.path;
      }

      // eval empty -> default eval
      if (!cleanText(next.evalFilePath)) {
        const xs = prof?.eval_files ?? [];
        const defEval = xs.find((f) => f.entry === "nn.bin") ?? xs[0] ?? null;
        next.evalFilePath = defEval ? defEval.path : "";
      }

      // book
      if (!next.bookEnabled) {
        next.bookFilePath = null;
      } else if (!cleanText(next.bookFilePath ?? "")) {
        const defBook = (prof?.book_db_files ?? [])[0] ?? null;
        next.bookFilePath = defBook ? defBook.path : null;
      }

      return next;
    });
  }, [open, draft, index, profiles, engines, engineFiltered.filtered]);

  const setOpt = useCallback((key: string, value: string) => {
    setDraft((cur) => {
      if (!cur) return cur;
      // 空文字 = ユーザーがクリアした = デフォルトに戻したい → entry を削除
      const nextOpts = { ...cur.options };
      if (value === "") {
        delete nextOpts[key];
      } else {
        nextOpts[key] = value;
      }
      return { ...cur, options: nextOpts };
    });
  }, []);

  const onResetAll = useCallback(() => {
    setDraft((cur) => (cur ? { ...cur, options: {} } : cur));
  }, []);

  const onCreateEnginesDir = useCallback(async () => {
    if (!aiRoot) return;
    try {
      setIndexStatus("loading");
      await ensureEnginesDir(aiRoot);
      rescan();
    } catch (e) {
      setIndexStatus("error");
      setIndexError(`engines/ の作成に失敗しました: ${String(e)}`);
    }
  }, [aiRoot, rescan]);

  const onSave = useCallback(async () => {
    if (!draft) return;

    const nextErrors: Record<string, string> = {};

    const label = cleanText(draft.label);
    const aiName = cleanText(draft.aiName);
    const enginePath = cleanText(draft.enginePath);
    const evalFilePath = cleanText(draft.evalFilePath);

    if (!label) nextErrors.label = "名前は必須です";
    if (!aiName) nextErrors.aiName = "AI名（プロファイル）を選択してください";
    if (!enginePath) nextErrors.enginePath = "エンジンを選択してください";
    if (!evalFilePath) nextErrors.evalFilePath = "評価関数ファイルを選択してください";

    const bookEnabled = Boolean(draft.bookEnabled);
    const bookFilePath = bookEnabled ? cleanText(draft.bookFilePath ?? "") || null : null;
    if (bookEnabled && !bookFilePath) nextErrors.bookFilePath = "定跡ファイルを選択してください";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // analysis: <=0 は落とす（軽く）。mode は preset 側に常に保持。
    const a: AnalysisDefaults = draft.analysis ?? { mode: "infinite" };
    const timeSeconds =
      a.timeSeconds != null ? clampInt(parseIntSafe(a.timeSeconds, 0), 0, 3600) : undefined;
    const depth = a.depth != null ? clampInt(parseIntSafe(a.depth, 0), 0, 999) : undefined;
    const nodes = a.nodes != null ? clampInt(parseIntSafe(a.nodes, 0), 0, 999_999_999) : undefined;

    const analysis: AnalysisDefaults = {
      mode: a.mode,
      timeSeconds: timeSeconds && timeSeconds > 0 ? timeSeconds : undefined,
      depth: depth && depth > 0 ? depth : undefined,
      nodes: nodes && nodes > 0 ? nodes : undefined,
    };

    // options: 空文字は除外（draft 側でも setOpt が空のとき delete するが念のため）。
    // DEFAULT_USI_OPTIONS は後方互換の baseline として残し、ユーザー編集で上書きする。
    const rawOpt = draft.options ?? {};
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawOpt)) {
      const vv = cleanText(String(v ?? ""));
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
      options: { ...DEFAULT_USI_OPTIONS, ...options },
      analysis,
    };

    await updatePreset(presetId, patch);
    onClose();
  }, [draft, onClose, presetId, updatePreset]);

  if (!preset || !draft) return null;

  const title = cleanText(draft.label) || "プリセット編集";

  return (
    <Modal
      onClose={onClose}
      theme="dark"
      size="lg"
      padding="none"
      variant="dialog"
      chrome="card"
      scroll="none"
      closeOnEsc={true}
      closeOnOverlay={true}
      showCloseButton={true}
    >
      <div className="presetDialog">
        <PresetDialogHeader title={title} />

        <div className="presetDialog__body">
          <BasicSection
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            setErrors={setErrors}
            aiRoot={aiRoot}
            chooseAiRoot={chooseAiRoot}
            rescan={rescan}
            indexStatus={indexStatus}
            indexError={indexError}
            scanReady={scanReady}
            profiles={profiles}
            currentProfile={currentProfile}
          />

          <EngineFilesSection
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            setErrors={setErrors}
            aiRootReady={Boolean(aiRoot)}
            scanReady={scanReady}
            index={index}
            indexStatus={indexStatus}
            enginesDirExists={Boolean(index?.engines_dir.exists)}
            enginesDirPath={index?.engines_dir.path ?? ""}
            onCreateEnginesDir={onCreateEnginesDir}
            rescan={rescan}
            engineFilterAi={engineFilterAi}
            setEngineFilterAi={setEngineFilterAi}
            engineFilterOptions={engineFilterOptions}
            engineFilteredEvalType={engineFiltered.evalType}
            engineOptions={engineOptions}
            currentProfile={currentProfile}
            evalOptions={evalOptions}
            bookOptions={bookOptions}
            evalFilesCount={evalFiles.length}
            bookDbsCount={bookDbs.length}
            profiles={profiles}
          />

          <UsiOptionsSection
            enginePath={cleanText(draft.enginePath) || null}
            options={draft.options ?? {}}
            setOpt={setOpt}
            onResetAll={onResetAll}
          />

          <AnalysisDefaultsSection draft={draft} setDraft={setDraft} />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={onSave} />
      </div>
    </Modal>
  );
}
