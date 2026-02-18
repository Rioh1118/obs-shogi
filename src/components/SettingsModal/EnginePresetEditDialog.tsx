import { useEffect, useMemo, useState, useCallback } from "react";
import "./EnginePresetEditDialog.scss";

import Modal from "@/components/Modal";
import { DEFAULT_OPTIONS } from "@/commands/engine";
import { useEnginePresets } from "@/contexts/EnginePresetsContext";
import { useAppConfig } from "@/contexts/AppConfigContext";
import type { EnginePreset, PresetId } from "@/types/enginePresets";

import {
  scanAiRoot,
  ensureEnginesDir,
  type AiRootIndex,
  type ProfileCandidate,
  type FileCandidate,
} from "@/commands/ai_library";

import { listAiLabels, filterEnginesByAiLabel } from "@/utils/engineFilter";

import SButton from "./ui/SButton";
import SField from "./ui/SField";
import SInput from "./ui/SInput";
import SRadioGroup, { type SRadioOption } from "./ui/SRadioGroup";
import SSection from "./ui/SSection";
import SSelect from "./ui/SSelect";

type Props = {
  presetId: PresetId;
  open: boolean;
  onClose: () => void;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

function deepClone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseIntSafe(v: unknown, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(s: string) {
  return (s ?? "").trim();
}

function basename(p: string) {
  const s = (p ?? "").replace(/\\/g, "/");
  const last = s.split("/").filter(Boolean).pop();
  return last || (p ?? "");
}

const QUICK_MULTIPV = [1, 3, 5, 10] as const;
const MULTIPV_MIN = 1;
const MULTIPV_MAX = 20;

const HASH_CHOICES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;

function pickDefaultEvalFile(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  const xs = profile?.eval_files ?? [];
  if (xs.length === 0) return null;
  return xs.find((f) => f.entry === "nn.bin") ?? xs[0];
}

function pickDefaultBookDb(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  const xs = profile?.book_db_files ?? [];
  if (xs.length === 0) return null;
  return xs[0];
}

/** Hookなしラッパー：Hookルール的に safe */
export default function EnginePresetEditDialog(props: Props) {
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
  const enginesAll = index?.engines ?? [];
  const profiles = useMemo(() => index?.profiles ?? [], [index?.profiles]);

  // "YaneuraOu*" のみ表示したいなら、ここで最小限フィルタ（parse不要）
  const engines = useMemo(
    () =>
      enginesAll.filter((e: any) =>
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
    setShowMultiPvCustom(!QUICK_MULTIPV.includes(mpv as any));

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

    const opts = filtered.map((e: any) => ({
      value: e.path,
      label: e.entry,
      disabled: !(e.kind === "file" || e.kind === "symlink"),
    }));

    // フィルタ外の現在選択を落とさない（UI壊れ防止）
    const cur = cleanText(draft?.enginePath ?? "");
    if (cur && !filtered.some((e: any) => e.path === cur)) {
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
      evalFiles.map((f: any) => ({
        value: f.path,
        label: f.entry,
        disabled: !(f.kind === "file" || f.kind === "symlink"),
      })),
    [evalFiles],
  );

  const bookOptions = useMemo(
    () =>
      bookDbs.map((f: any) => ({
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

  const aiRootReady = Boolean(aiRoot);
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
        const defEval = pickDefaultEvalFile(prof);
        next.evalFilePath = defEval ? defEval.path : "";
      }

      // book
      if (!next.bookEnabled) {
        next.bookFilePath = null;
      } else if (!cleanText(next.bookFilePath ?? "")) {
        const defBook = pickDefaultBookDb(prof);
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
    (mode: "auto" | "manual") => {
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

  const threadsModeOptions: SRadioOption[] = useMemo(
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

  const hashModeOptions: SRadioOption[] = useMemo(
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

  // Hooks後の return はOK（Hookルールに抵触しない）
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
            aiRootReady={aiRootReady}
            scanReady={scanReady}
            index={index}
            indexStatus={indexStatus}
            enginesDirExists={Boolean(index?.engines_dir.exists)}
            enginesDirPath={index?.engines_dir.path ?? ""}
            onCreateEnginesDir={onCreateEnginesDir}
            rescan={rescan}
            // filter ui
            engineFilterAi={engineFilterAi}
            setEngineFilterAi={setEngineFilterAi}
            engineFilterOptions={engineFilterOptions}
            engineFilteredEvalType={engineFiltered.evalType}
            engineOptions={engineOptions}
            // eval/book
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

/* =========================
 * Presentational Components
 * ========================= */

function PresetDialogHeader({ title }: { title: string }) {
  return (
    <header className="presetDialog__header">
      <div className="presetDialog__titles">
        <div className="presetDialog__title">{title}</div>
        <div className="presetDialog__subtitle">
          保存時にプリセットが更新され、必要なら自動でエンジンが再起動されます。
        </div>
      </div>
    </header>
  );
}

function PresetDialogFooter({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <footer className="presetDialog__footer">
      <div className="presetDialog__footerLeft">
        <div className="presetDialog__footerHint">
          ※ 編集中は保存されません。保存で確定します。
        </div>
      </div>

      <div className="presetDialog__footerRight">
        <SButton variant="ghost" onClick={onClose}>
          キャンセル
        </SButton>
        <SButton variant="primary" onClick={onSave}>
          保存
        </SButton>
      </div>
    </footer>
  );
}

/* =========================
 * Sections
 * ========================= */

function BasicSection(props: {
  draft: EnginePreset;
  setDraft: React.Dispatch<React.SetStateAction<EnginePreset | null>>;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  aiRoot: string | null;
  chooseAiRoot?: (() => void) | null;
  rescan: () => void;
  indexStatus: "idle" | "loading" | "ok" | "error";
  indexError: string | null;
  scanReady: boolean;
  profiles: ProfileCandidate[];
  currentProfile: ProfileCandidate | null;
}) {
  const {
    draft,
    setDraft,
    errors,
    setErrors,
    aiRoot,
    chooseAiRoot,
    rescan,
    indexStatus,
    indexError,
    scanReady,
    profiles,
    currentProfile,
  } = props;

  const aiRootReady = Boolean(aiRoot);

  const profileOptions = useMemo(() => {
    return profiles.map((p) => {
      const tag = [
        p.has_eval_dir ? null : "evalなし",
        p.has_book_dir ? null : "bookなし",
      ]
        .filter(Boolean)
        .join(" / ");

      return {
        value: p.name,
        label: tag ? `${p.name}（${tag}）` : p.name,
        disabled: !p.has_eval_dir,
      };
    });
  }, [profiles]);

  return (
    <SSection title="基本" description="表示名とAI_ROOT / プロファイル選択">
      <div className="presetDialog__grid2">
        <SField
          label="プリセット名"
          htmlFor="preset-label"
          error={errors.label}
        >
          <SInput
            id="preset-label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="例: 研究用 / 速解析 / 定跡整備 など"
            invalid={!!errors.label}
          />
        </SField>

        <SField
          label="AI_ROOT"
          description={
            aiRoot
              ? `現在: ${aiRoot}`
              : "未設定です。AI_ROOT を選択してください。"
          }
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SButton variant="ghost" size="sm" onClick={() => chooseAiRoot?.()}>
              AI_ROOT を選択…
            </SButton>

            <SButton
              variant="ghost"
              size="sm"
              onClick={rescan}
              disabled={!aiRootReady || indexStatus === "loading"}
              isLoading={indexStatus === "loading"}
            >
              再スキャン
            </SButton>
          </div>

          {indexStatus === "error" && indexError && (
            <div
              className="engineTab__error"
              role="alert"
              style={{ marginTop: 10 }}
            >
              {indexError}
            </div>
          )}
        </SField>
      </div>

      <div className="presetDialog__grid2" style={{ marginTop: 14 }}>
        <SField
          label="AI名（プロファイル）"
          htmlFor="preset-ainame"
          description="ai_root 直下（engines を除く）から eval/ を持つディレクトリを選択します。"
          error={errors.aiName}
        >
          <SSelect
            value={draft.aiName ?? ""}
            onChange={(e) => {
              const name = e.target.value;

              setDraft((cur) => {
                if (!cur) return cur;
                const next: EnginePreset = { ...cur, aiName: name };

                // profile変更に合わせて eval/book を “最小限” 更新
                const prof = profiles.find((p) => p.name === name) ?? null;

                const defEval = pickDefaultEvalFile(prof);
                next.evalFilePath = defEval ? defEval.path : "";

                if (next.bookEnabled) {
                  const defBook = pickDefaultBookDb(prof);
                  next.bookFilePath = defBook ? defBook.path : null;
                }

                return next;
              });

              setErrors((es) => ({ ...es, aiName: "" }));
            }}
            options={profileOptions}
            placeholder={
              !aiRootReady
                ? "AI_ROOT を設定してください"
                : scanReady
                  ? "プロファイルを選択"
                  : "スキャン結果なし"
            }
            disabled={!aiRootReady || !scanReady}
            invalid={!!errors.aiName}
          />
        </SField>

        <SField
          label="選択中のプロファイル"
          description={
            currentProfile
              ? `eval: ${currentProfile.eval_files.length} / book(db): ${currentProfile.book_db_files.length}`
              : "未選択"
          }
        >
          <SInput value={currentProfile?.path ?? ""} readOnly placeholder="—" />
        </SField>
      </div>
    </SSection>
  );
}

function EngineFilesSection(props: {
  draft: EnginePreset;
  setDraft: React.Dispatch<React.SetStateAction<EnginePreset | null>>;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  aiRootReady: boolean;
  scanReady: boolean;
  index: AiRootIndex | null;
  indexStatus: "idle" | "loading" | "ok" | "error";
  enginesDirExists: boolean;
  enginesDirPath: string;
  onCreateEnginesDir: () => void;
  rescan: () => void;

  engineFilterAi: string;
  setEngineFilterAi: (v: string) => void;
  engineFilterOptions: Array<{ value: string; label: string }>;
  engineFilteredEvalType: string | null;

  engineOptions: Array<{ value: string; label: string; disabled?: boolean }>;

  currentProfile: ProfileCandidate | null;
  evalOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  bookOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  evalFilesCount: number;
  bookDbsCount: number;

  profiles: ProfileCandidate[];
}) {
  const {
    draft,
    setDraft,
    errors,
    setErrors,
    aiRootReady,
    scanReady,
    index,
    indexStatus,
    enginesDirExists,
    enginesDirPath,
    onCreateEnginesDir,
    rescan,
    engineFilterAi,
    setEngineFilterAi,
    engineFilterOptions,
    engineFilteredEvalType,
    engineOptions,
    currentProfile,
    evalOptions,
    bookOptions,
    evalFilesCount,
    bookDbsCount,
    profiles,
  } = props;

  return (
    <SSection
      title="エンジン・ファイル"
      description="ai_root から候補を列挙し、選択だけで絶対パスを自動設定します。"
    >
      {scanReady && index && !enginesDirExists && (
        <div className="presetDialog__hintWarn" style={{ marginBottom: 12 }}>
          engines/ ディレクトリが存在しません（{enginesDirPath}）。
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <SButton variant="primary" size="sm" onClick={onCreateEnginesDir}>
              engines/ を作成
            </SButton>
            <SButton variant="ghost" size="sm" onClick={rescan}>
              再スキャン
            </SButton>
          </div>
        </div>
      )}

      <div className="presetDialog__stack">
        <SField
          label="エンジン絞り込み（任意）"
          description={
            engineFilteredEvalType
              ? `EvalType: ${engineFilteredEvalType}（保存されません）`
              : "AIラベル → EvalType で候補を絞ります（保存されません）"
          }
        >
          <SSelect
            value={engineFilterAi}
            onChange={(e) => setEngineFilterAi(e.target.value)}
            options={engineFilterOptions}
            disabled={!aiRootReady || !scanReady}
            placeholder={!scanReady ? "スキャン結果なし" : "絞り込みなし"}
          />
        </SField>

        <SField
          label="エンジン（ai_root/engines）"
          description="YaneuraOu* のみ表示されます。"
          error={errors.enginePath}
        >
          <SSelect
            value={draft.enginePath ?? ""}
            onChange={(e) => {
              const path = e.target.value;
              setDraft({ ...draft, enginePath: path });
              setErrors((es) => ({ ...es, enginePath: "" }));
            }}
            options={engineOptions}
            placeholder={
              !aiRootReady
                ? "AI_ROOT を設定してください"
                : scanReady
                  ? engineOptions.length > 0
                    ? "エンジンを選択"
                    : "候補がありません（engines/にYaneuraOu*を配置）"
                  : indexStatus === "loading"
                    ? "スキャン中…"
                    : "スキャン結果なし"
            }
            disabled={!aiRootReady || !scanReady || engineOptions.length === 0}
            invalid={!!errors.enginePath}
          />
          {!!draft.enginePath && (
            <div className="presetDialog__hintMuted" style={{ marginTop: 8 }}>
              選択: <b>{basename(draft.enginePath)}</b>
            </div>
          )}
        </SField>

        <SField
          label="評価関数ファイル（<profile>/eval）"
          description="nn.bin を優先表示します（存在すれば自動選択）。"
          error={errors.evalFilePath}
        >
          <SSelect
            value={draft.evalFilePath ?? ""}
            onChange={(e) => {
              const path = e.target.value;
              setDraft({ ...draft, evalFilePath: path });
              setErrors((es) => ({ ...es, evalFilePath: "" }));
            }}
            options={evalOptions}
            placeholder={
              !currentProfile
                ? "まずプロファイルを選択"
                : currentProfile.has_eval_dir
                  ? evalFilesCount > 0
                    ? "評価関数ファイルを選択"
                    : "eval/ にファイルがありません"
                  : "このプロファイルには eval/ がありません"
            }
            disabled={
              !currentProfile ||
              !currentProfile.has_eval_dir ||
              evalFilesCount === 0
            }
            invalid={!!errors.evalFilePath}
          />
          {!!draft.evalFilePath && (
            <div className="presetDialog__hintMuted" style={{ marginTop: 8 }}>
              選択: <b>{basename(draft.evalFilePath)}</b>
            </div>
          )}
        </SField>

        <div className="presetDialog__row">
          <label className="presetDialog__check">
            <input
              type="checkbox"
              checked={Boolean(draft.bookEnabled)}
              onChange={(e) => {
                const on = e.target.checked;

                setDraft((cur) => {
                  if (!cur) return cur;
                  const next: EnginePreset = {
                    ...cur,
                    bookEnabled: on,
                    bookFilePath: on ? (cur.bookFilePath ?? null) : null,
                  };

                  if (on) {
                    // ONにした瞬間、空ならデフォルト
                    const prof =
                      profiles.find(
                        (p) => p.name === (next.aiName ?? "").trim(),
                      ) ?? null;
                    if (!next.bookFilePath) {
                      const def = pickDefaultBookDb(prof);
                      next.bookFilePath = def ? def.path : null;
                    }
                  }
                  return next;
                });

                setErrors((es) => ({ ...es, bookFilePath: "" }));
              }}
            />
            <span className="presetDialog__checkLabel">定跡（book）を使う</span>
          </label>
        </div>

        {draft.bookEnabled && (
          <SField
            label="定跡ファイル（<profile>/book/*.db）"
            description="book/ 配下の .db のみ候補になります。"
            error={errors.bookFilePath}
          >
            <SSelect
              value={draft.bookFilePath ?? ""}
              onChange={(e) => {
                const path = e.target.value;
                setDraft({ ...draft, bookFilePath: path || null });
                setErrors((es) => ({ ...es, bookFilePath: "" }));
              }}
              options={bookOptions}
              placeholder={
                !currentProfile
                  ? "まずプロファイルを選択"
                  : currentProfile.has_book_dir
                    ? bookDbsCount > 0
                      ? "定跡ファイルを選択"
                      : "book/ に .db がありません"
                    : "このプロファイルには book/ がありません"
              }
              disabled={
                !currentProfile ||
                !currentProfile.has_book_dir ||
                bookDbsCount === 0
              }
              invalid={!!errors.bookFilePath}
            />
            {!!draft.bookFilePath && (
              <div className="presetDialog__hintMuted" style={{ marginTop: 8 }}>
                選択: <b>{basename(draft.bookFilePath)}</b>
              </div>
            )}
          </SField>
        )}

        <details className="presetDialog__details">
          <summary className="presetDialog__summary">
            高度な設定（手動パス編集）
          </summary>
          <div className="presetDialog__detailsBody">
            <div className="presetDialog__stack">
              <SField label="エンジンパス（手動）">
                <SInput
                  value={draft.enginePath}
                  onChange={(e) =>
                    setDraft({ ...draft, enginePath: e.target.value })
                  }
                  placeholder="/path/to/YaneuraOu*"
                />
              </SField>
              <SField label="評価関数ファイル（手動）">
                <SInput
                  value={draft.evalFilePath}
                  onChange={(e) =>
                    setDraft({ ...draft, evalFilePath: e.target.value })
                  }
                  placeholder="/path/to/eval/nn.bin"
                />
              </SField>
              {draft.bookEnabled && (
                <SField label="定跡ファイル（手動）">
                  <SInput
                    value={draft.bookFilePath ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, bookFilePath: e.target.value })
                    }
                    placeholder="/path/to/book/*.db"
                  />
                </SField>
              )}
            </div>
          </div>
        </details>
      </div>
    </SSection>
  );
}

function ImportantOptionsSection(props: {
  draft: EnginePreset;
  setOpt: (k: string, v: string) => void;

  multiPv: number;
  showMultiPvCustom: boolean;
  setShowMultiPvCustom: (v: boolean) => void;
  onChangeMultiPv: (n: number) => void;

  cores: number;
  threadsMode: "auto" | "manual";
  threadsModeOptions: SRadioOption[];
  onThreadsModeChange: (m: "auto" | "manual") => void;
  threadsManual: number;
  threadChoices: number[];
  onThreadsManualChange: (n: number) => void;

  hashMode: "auto" | "manual";
  hashModeOptions: SRadioOption[];
  hashManual: number;
  onHashModeChange: (m: "auto" | "manual") => void;
  onHashManualChange: (n: number) => void;
}) {
  const {
    draft,
    setOpt,
    multiPv,
    showMultiPvCustom,
    setShowMultiPvCustom,
    onChangeMultiPv,
    cores,
    threadsMode,
    threadsModeOptions,
    onThreadsModeChange,
    threadsManual,
    threadChoices,
    onThreadsManualChange,
    hashMode,
    hashModeOptions,
    hashManual,
    onHashModeChange,
    onHashManualChange,
  } = props;

  return (
    <SSection
      title="重要オプション"
      description="研究・定跡管理では対局向けの時間調整系は基本不要です（下の折りたたみに隔離）。"
    >
      <div className="presetDialog__stack">
        {/* MultiPV */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">MultiPV（候補手数）</div>
            <div className="presetDialog__blockSub">
              候補を増やすと、1手あたりの読みは浅くなります。
            </div>
          </div>

          <div className="presetDialog__segRow">
            <div
              className="presetDialog__seg"
              role="tablist"
              aria-label="MultiPV presets"
            >
              {QUICK_MULTIPV.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={cx(
                    "presetDialog__segBtn",
                    multiPv === n && "is-active",
                  )}
                  onClick={() => onChangeMultiPv(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <SButton
              variant="ghost"
              size="sm"
              onClick={() => setShowMultiPvCustom(!showMultiPvCustom)}
              className="presetDialog__segRight"
            >
              カスタム…
            </SButton>
          </div>

          {showMultiPvCustom && (
            <div className="presetDialog__stepper">
              <SButton
                variant="ghost"
                size="sm"
                onClick={() => onChangeMultiPv(multiPv - 1)}
                disabled={multiPv <= MULTIPV_MIN}
              >
                −
              </SButton>

              <SInput
                className="presetDialog__stepperInput"
                inputMode="numeric"
                type="number"
                min={MULTIPV_MIN}
                max={MULTIPV_MAX}
                value={multiPv}
                onChange={(e) =>
                  onChangeMultiPv(parseIntSafe(e.target.value, MULTIPV_MIN))
                }
              />

              <SButton
                variant="ghost"
                size="sm"
                onClick={() => onChangeMultiPv(multiPv + 1)}
                disabled={multiPv >= MULTIPV_MAX}
              >
                ＋
              </SButton>

              <div className="presetDialog__stepperHint">
                範囲: {MULTIPV_MIN}〜{MULTIPV_MAX}
              </div>
            </div>
          )}

          {multiPv >= 2 && (
            <div className="presetDialog__hintWarn">
              注意: MultiPV を 2以上にすると棋力が低下し得ます（研究用途では “幅
              vs 深さ” の調整として有用）。
            </div>
          )}
        </div>

        {/* Threads */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">Threads（並列数）</div>
            <div className="presetDialog__blockSub">
              上げすぎると熱/騒音や効率低下の可能性があります。
            </div>
          </div>

          <SRadioGroup
            name="threadsMode"
            options={threadsModeOptions}
            value={threadsMode}
            onChange={(v) => onThreadsModeChange(v as any)}
            layout="list"
          />

          {threadsMode === "manual" && (
            <div className="presetDialog__inline">
              <SField
                label="手動 Threads"
                description={`最大: 論理コア数 ${cores}`}
              >
                <SSelect
                  value={String(threadsManual)}
                  onChange={(e) =>
                    onThreadsManualChange(parseIntSafe(e.target.value, 1))
                  }
                  options={threadChoices.map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
              </SField>
            </div>
          )}
        </div>

        {/* Hash */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">
              解析メモリ（USI_Hash）
            </div>
            <div className="presetDialog__blockSub">
              置換表サイズ（MB）。長時間思考で効くことがあります。
            </div>
          </div>

          <SRadioGroup
            name="hashMode"
            options={hashModeOptions}
            value={hashMode}
            onChange={(v) => onHashModeChange(v as any)}
            layout="list"
          />

          {hashMode === "manual" && (
            <div className="presetDialog__inline">
              <SField
                label="手動 Hash"
                description={
                  <span>
                    推定使用RAM: <b>{hashManual}MB</b>（＋α）
                  </span>
                }
              >
                <SSelect
                  value={String(hashManual)}
                  onChange={(e) =>
                    onHashManualChange(parseIntSafe(e.target.value, 1024))
                  }
                  options={HASH_CHOICES.map((n) => ({
                    value: String(n),
                    label: `${n} MB`,
                  }))}
                />
              </SField>
            </div>
          )}
        </div>
      </div>

      <details className="presetDialog__details">
        <summary className="presetDialog__summary">対局向け（非推奨）</summary>
        <div className="presetDialog__detailsBody">
          <div className="presetDialog__grid2">
            <SField
              label="NetworkDelay"
              description="通信遅延の想定（対局向け）"
            >
              <SInput
                type="number"
                value={
                  draft.options.NetworkDelay ?? DEFAULT_OPTIONS.NetworkDelay
                }
                onChange={(e) =>
                  setOpt(
                    "NetworkDelay",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField label="NetworkDelay2" description="通信遅延2（対局向け）">
              <SInput
                type="number"
                value={
                  draft.options.NetworkDelay2 ?? DEFAULT_OPTIONS.NetworkDelay2
                }
                onChange={(e) =>
                  setOpt(
                    "NetworkDelay2",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField
              label="MinimumThinkingTime"
              description="最小思考時間（対局向け）"
            >
              <SInput
                type="number"
                value={
                  draft.options.MinimumThinkingTime ??
                  DEFAULT_OPTIONS.MinimumThinkingTime
                }
                onChange={(e) =>
                  setOpt(
                    "MinimumThinkingTime",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField label="SlowMover" description="秒読み配分（対局向け）">
              <SInput
                type="number"
                value={draft.options.SlowMover ?? DEFAULT_OPTIONS.SlowMover}
                onChange={(e) =>
                  setOpt("SlowMover", String(parseIntSafe(e.target.value, 0)))
                }
              />
            </SField>
          </div>

          <div className="presetDialog__hintMuted">
            研究・定跡管理アプリ（対戦なし）なら、ここは基本いじらなくてOKです。
          </div>
        </div>
      </details>
    </SSection>
  );
}

function AnalysisDefaultsSection(props: {
  draft: EnginePreset;
  setDraft: React.Dispatch<React.SetStateAction<EnginePreset | null>>;
}) {
  const { draft, setDraft } = props;

  return (
    <SSection
      title="解析デフォルト（フロント保持）"
      description="バックエンド非対応でもUI側で保持します"
    >
      <div className="presetDialog__grid3">
        <SField label="Time (sec)" description="優先: 時間">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.timeSeconds ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  timeSeconds: n,
                },
              });
            }}
          />
        </SField>

        <SField label="Depth" description="優先: 深さ">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.depth ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  depth: n,
                },
              });
            }}
          />
        </SField>

        <SField label="Nodes" description="優先: ノード数">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.nodes ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  nodes: n,
                },
              });
            }}
          />
        </SField>
      </div>

      <div className="presetDialog__row">
        <label className="presetDialog__check">
          <input
            type="checkbox"
            checked={Boolean(draft.analysis?.mateSearch)}
            onChange={(e) => {
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  mateSearch: e.target.checked,
                },
              });
            }}
          />
          <span className="presetDialog__checkLabel">
            詰み探索（フロント保持）
          </span>
        </label>
      </div>
    </SSection>
  );
}
