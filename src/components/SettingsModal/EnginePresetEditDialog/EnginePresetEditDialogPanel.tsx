import { useCallback, useEffect, useMemo, useState } from "react";
import "./EnginePresetEditDialogPanel.scss";

import Modal from "@/components/Modal";
import { DEFAULT_OPTIONS } from "@/commands/engine";
import { useEnginePresets } from "@/contexts/EnginePresetsContext";
import type { EnginePreset, PresetId } from "@/types/enginePresets";

import {
  scanAiRoot,
  ensureEnginesDir,
  type AiRootIndex,
  type EngineCandidate,
} from "@/commands/ai_library";

import { listAiLabels, filterEnginesByAiLabel } from "@/utils/engineFilter";
import {
  basename,
  clampInt,
  cleanText,
  deepClone,
  MULTIPV_MAX,
  MULTIPV_MIN,
  parseIntSafe,
  QUICK_MULTIPV_SET,
} from "@/utils/enginePresetDialog";
import PresetDialogHeader from "./PresetDialogHeader";
import BasicSection from "./BasicSection";
import EngineFilesSection from "./EngineFilesSection";
import ImportantOptionsSection from "./ImportantOptionsSection";
import AnalysisDefaultsSection from "./AnalysisDefaultsSection";
import PresetDialogFooter from "./PresetDialogFooter";
import type { ThreadsMode } from "@/utils/engineSettings";
import { useAppConfig } from "@/entities/app-config";

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
  const [indexStatus, setIndexStatus] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
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
    () =>
      enginesAll.filter((e: EngineCandidate) =>
        String(e.entry ?? "").startsWith("YaneuraOu_"),
      ),
    [enginesAll],
  );

  // ---- draft ----
  const [draft, setDraft] = useState<EnginePreset | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Dialog-only: エンジン絞り込み（保存しない）
  const [engineFilterAi, setEngineFilterAi] = useState("");

  // ---- CPU recommended ----
  const cores = useMemo(() => {
    const c =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    return clampInt(c, 1, 128);
  }, []);

  const recommendedThreads = useMemo(
    () => clampInt(Math.min(cores, 8), 1, cores),
    [cores],
  );

  // ---- MultiPV/Threads/Hash UI state ----
  const [multiPv, setMultiPv] = useState(1);
  const [showMultiPvCustom, setShowMultiPvCustom] = useState(false);

  const [threadsMode, setThreadsMode] = useState<"auto" | "manual">("auto");
  const [threadsManual, setThreadsManual] = useState(recommendedThreads);

  const [hashMode, setHashMode] = useState<"auto" | "manual">("auto");
  const [hashManual, setHashManual] = useState(
    parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024),
  );

  // preset → draft 初期化
  useEffect(() => {
    if (!open) return;
    if (!preset) return;

    const d = deepClone(preset);
    setDraft(d);
    setErrors({});

    const mpv = clampInt(
      parseIntSafe(
        d.options?.MultiPV,
        parseIntSafe(DEFAULT_OPTIONS.MultiPV, 1),
      ),
      MULTIPV_MIN,
      MULTIPV_MAX,
    );
    setMultiPv(mpv);
    setShowMultiPvCustom(!QUICK_MULTIPV_SET.has(mpv));

    const t = clampInt(
      parseIntSafe(
        d.options?.Threads,
        parseIntSafe(DEFAULT_OPTIONS.Threads, recommendedThreads),
      ),
      1,
      cores,
    );
    setThreadsManual(t);
    setThreadsMode(t === recommendedThreads ? "auto" : "manual");

    const h = clampInt(
      parseIntSafe(
        d.options?.USI_Hash,
        parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024),
      ),
      128,
      65536,
    );
    setHashManual(h);
    setHashMode(
      h === parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024) ? "auto" : "manual",
    );
  }, [open, preset, cores, recommendedThreads]);

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

  const bookDbs = useMemo(
    () => currentProfile?.book_db_files ?? [],
    [currentProfile],
  );

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

  const threadChoices = useMemo(() => {
    const base = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128];
    const xs = base.filter((n) => n <= cores);
    if (!xs.includes(cores)) xs.push(cores);
    xs.sort((a, b) => a - b);
    return xs;
  }, [cores]);

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

      const prof =
        profiles.find((p) => p.name === cleanText(next.aiName)) ?? null;

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
      return { ...cur, options: { ...(cur.options ?? {}), [key]: value } };
    });
  }, []);

  const onChangeMultiPv = useCallback(
    (n: number) => {
      const v = clampInt(n, MULTIPV_MIN, MULTIPV_MAX);
      setMultiPv(v);
      setOpt("MultiPV", String(v));
    },
    [setOpt],
  );

  const onThreadsModeChange = useCallback(
    (mode: ThreadsMode) => {
      setThreadsMode(mode);
      if (mode === "auto") {
        setThreadsManual(recommendedThreads);
        setOpt("Threads", String(recommendedThreads));
      } else {
        setOpt("Threads", String(clampInt(threadsManual, 1, cores)));
      }
    },
    [cores, recommendedThreads, setOpt, threadsManual],
  );

  const onThreadsManualChange = useCallback(
    (n: number) => {
      const v = clampInt(n, 1, cores);
      setThreadsManual(v);
      setOpt("Threads", String(v));
    },
    [cores, setOpt],
  );

  const onHashModeChange = useCallback(
    (mode: "auto" | "manual") => {
      setHashMode(mode);
      if (mode === "auto") {
        const v = parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024);
        setHashManual(v);
        setOpt("USI_Hash", String(v));
      } else {
        const v = clampInt(hashManual, 128, 65536);
        setOpt("USI_Hash", String(v));
      }
    },
    [hashManual, setOpt],
  );

  const onHashManualChange = useCallback(
    (n: number) => {
      const v = clampInt(n, 128, 65536);
      setHashManual(v);
      setOpt("USI_Hash", String(v));
    },
    [setOpt],
  );

  const threadsModeOptions = useMemo(
    () => [
      {
        value: "auto",
        label: "自動（推奨）",
        description: `この端末の論理コア数を元に推奨値 ${recommendedThreads} を設定`,
      },
      {
        value: "manual",
        label: "手動",
        description: "数を固定します（上げすぎると熱/騒音や効率低下の可能性）",
      },
    ],
    [recommendedThreads],
  );

  const hashModeOptions = useMemo(
    () => [
      {
        value: "auto",
        label: "自動（推奨）",
        description: `デフォルト ${DEFAULT_OPTIONS.USI_Hash}MB を使用`,
      },
      {
        value: "manual",
        label: "手動",
        description: "長時間思考で効くことがあります（大きすぎるとRAM消費）",
      },
    ],
    [],
  );

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
    if (!evalFilePath)
      nextErrors.evalFilePath = "評価関数ファイルを選択してください";

    const bookEnabled = Boolean(draft.bookEnabled);
    const bookFilePath = bookEnabled
      ? cleanText(draft.bookFilePath ?? "") || null
      : null;
    if (bookEnabled && !bookFilePath)
      nextErrors.bookFilePath = "定跡ファイルを選択してください";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // analysis: <=0 は落とす（軽く）
    const a = draft.analysis ?? { mateSearch: false };
    const timeSeconds =
      a.timeSeconds != null
        ? clampInt(parseIntSafe(a.timeSeconds, 0), 0, 3600)
        : undefined;
    const depth =
      a.depth != null ? clampInt(parseIntSafe(a.depth, 0), 0, 999) : undefined;
    const nodes =
      a.nodes != null
        ? clampInt(parseIntSafe(a.nodes, 0), 0, 999_999_999)
        : undefined;

    const analysis =
      (timeSeconds && timeSeconds > 0) ||
      (depth && depth > 0) ||
      (nodes && nodes > 0) ||
      a.mateSearch
        ? {
            timeSeconds:
              timeSeconds && timeSeconds > 0 ? timeSeconds : undefined,
            depth: depth && depth > 0 ? depth : undefined,
            nodes: nodes && nodes > 0 ? nodes : undefined,
            mateSearch: Boolean(a.mateSearch),
          }
        : undefined;

    // options: 空は入れない + UI state 優先
    const rawOpt = draft.options ?? {};
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawOpt)) {
      const vv = cleanText(String(v ?? ""));
      if (!vv) continue;
      options[k] = vv;
    }

    options.MultiPV = String(clampInt(multiPv, MULTIPV_MIN, MULTIPV_MAX));
    options.Threads =
      threadsMode === "auto"
        ? String(recommendedThreads)
        : String(clampInt(threadsManual, 1, cores));
    options.USI_Hash =
      hashMode === "auto"
        ? String(parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024))
        : String(clampInt(hashManual, 128, 65536));

    const patch: Partial<EnginePreset> = {
      label,
      aiName,
      enginePath,
      evalFilePath,
      bookEnabled,
      bookFilePath,
      options: { ...DEFAULT_OPTIONS, ...options },
      analysis,
    };

    await updatePreset(presetId, patch);
    onClose();
  }, [
    cores,
    draft,
    hashManual,
    hashMode,
    multiPv,
    onClose,
    presetId,
    recommendedThreads,
    threadsManual,
    threadsMode,
    updatePreset,
  ]);

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

          <ImportantOptionsSection
            draft={draft}
            setOpt={setOpt}
            // MultiPV
            multiPv={multiPv}
            showMultiPvCustom={showMultiPvCustom}
            setShowMultiPvCustom={setShowMultiPvCustom}
            onChangeMultiPv={onChangeMultiPv}
            // Threads
            cores={cores}
            threadsMode={threadsMode}
            threadsModeOptions={threadsModeOptions}
            onThreadsModeChange={onThreadsModeChange}
            threadsManual={threadsManual}
            threadChoices={threadChoices}
            onThreadsManualChange={onThreadsManualChange}
            // Hash
            hashMode={hashMode}
            hashModeOptions={hashModeOptions}
            hashManual={hashManual}
            onHashModeChange={onHashModeChange}
            onHashManualChange={onHashManualChange}
          />

          <AnalysisDefaultsSection draft={draft} setDraft={setDraft} />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={onSave} />
      </div>
    </Modal>
  );
}
