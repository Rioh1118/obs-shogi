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

import SButton from "./ui/SButton";
import SField from "./ui/SField";
import SInput from "./ui/SInput";
import SRadioGroup, { type SRadioOption } from "./ui/SRadioGroup";
import SSection from "./ui/SSection";
import SSelect from "./ui/SSelect";

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

function cleanPath(s: string) {
  return (s ?? "").trim();
}

function cleanLabel(s: string) {
  return (s ?? "").trim();
}

function cleanAiName(s: string) {
  return (s ?? "").trim();
}

function basename(p: string) {
  const s = (p ?? "").replace(/\\/g, "/");
  const last = s.split("/").filter(Boolean).pop();
  return last || (p ?? "");
}

type Props = {
  presetId: PresetId;
  open: boolean;
  onClose: () => void;
};

const QUICK_MULTIPV = [1, 3, 5, 10] as const;
const MULTIPV_MIN = 1;
const MULTIPV_MAX = 20;

const HASH_CHOICES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;

function pickDefaultEvalFile(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  if (!profile) return null;
  if (!profile.eval_files || profile.eval_files.length === 0) return null;
  const nn = profile.eval_files.find((f) => f.entry === "nn.bin");
  return nn ?? profile.eval_files[0];
}

function pickDefaultBookDb(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  if (!profile) return null;
  if (!profile.book_db_files || profile.book_db_files.length === 0) return null;
  // 先頭（ソート済み）でOK。好みで "user_book*.db" 優先とかにもできる
  return profile.book_db_files[0];
}

export default function EnginePresetEditDialog({
  presetId,
  open,
  onClose,
}: Props) {
  const { state, updatePreset } = useEnginePresets();
  const { config, chooseAiRoot } = useAppConfig();

  const preset = useMemo(
    () => state.presets.find((p) => p.id === presetId) ?? null,
    [state.presets, presetId],
  );

  const aiRoot = config?.ai_root ?? null;

  // ---- index (scan result) ----
  const [index, setIndex] = useState<AiRootIndex | null>(null);
  const [indexStatus, setIndexStatus] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);

  const rescan = useCallback(() => setScanNonce((n) => n + 1), []);

  // scan ai_root when dialog opens
  useEffect(() => {
    if (!open) return;
    if (!aiRoot) {
      setIndex(null);
      setIndexStatus("idle");
      setIndexError(null);
      return;
    }

    let cancelled = false;

    (async () => {
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

  const cores = useMemo(() => {
    const c =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    return clampInt(c, 1, 128);
  }, []);

  const recommendedThreads = useMemo(() => {
    return clampInt(Math.min(cores, 8), 1, cores);
  }, [cores]);

  const [draft, setDraft] = useState<EnginePreset | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ---- MultiPV UI state ----
  const [multiPv, setMultiPv] = useState<number>(1);
  const [showMultiPvCustom, setShowMultiPvCustom] = useState(false);

  // ---- Threads UI state ----
  const [threadsMode, setThreadsMode] = useState<"auto" | "manual">("auto");
  const [threadsManual, setThreadsManual] =
    useState<number>(recommendedThreads);

  // ---- Hash UI state ----
  const [hashMode, setHashMode] = useState<"auto" | "manual">("auto");
  const [hashManual, setHashManual] = useState<number>(
    parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024),
  );

  // init draft when open/preset changes
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

  // if preset disappeared
  useEffect(() => {
    if (!open) return;
    if (!preset) onClose();
  }, [open, preset, onClose]);

  const threadChoices = useMemo(() => {
    const base = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128];
    const xs = base.filter((n) => n <= cores);
    if (!xs.includes(cores)) xs.push(cores);
    xs.sort((a, b) => a - b);
    return xs;
  }, [cores]);

  const setOpt = (key: string, value: string) => {
    setDraft((cur) => {
      if (!cur) return cur;
      return { ...cur, options: { ...(cur.options ?? {}), [key]: value } };
    });
  };

  const onChangeMultiPv = (n: number) => {
    const v = clampInt(n, MULTIPV_MIN, MULTIPV_MAX);
    setMultiPv(v);
    setOpt("MultiPV", String(v));
  };

  const onThreadsModeChange = (mode: "auto" | "manual") => {
    setThreadsMode(mode);
    if (mode === "auto") {
      setThreadsManual(recommendedThreads);
      setOpt("Threads", String(recommendedThreads));
    } else {
      const v = clampInt(threadsManual, 1, cores);
      setOpt("Threads", String(v));
    }
  };

  const onThreadsManualChange = (n: number) => {
    const v = clampInt(n, 1, cores);
    setThreadsManual(v);
    setOpt("Threads", String(v));
  };

  const onHashModeChange = (mode: "auto" | "manual") => {
    setHashMode(mode);
    if (mode === "auto") {
      const v = parseIntSafe(DEFAULT_OPTIONS.USI_Hash, 1024);
      setHashManual(v);
      setOpt("USI_Hash", String(v));
    } else {
      const v = clampInt(hashManual, 128, 65536);
      setOpt("USI_Hash", String(v));
    }
  };

  const onHashManualChange = (n: number) => {
    const v = clampInt(n, 128, 65536);
    setHashManual(v);
    setOpt("USI_Hash", String(v));
  };

  const threadsModeOptions: SRadioOption[] = [
    {
      value: "auto",
      label: `自動（推奨）`,
      description: `この端末の論理コア数を元に推奨値 ${recommendedThreads} を設定`,
    },
    {
      value: "manual",
      label: "手動",
      description: "数を固定します（上げすぎると熱/騒音や効率低下の可能性）",
    },
  ];

  const hashModeOptions: SRadioOption[] = [
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
  ];

  // ---- derived candidates from index ----
  const engines = index?.engines ?? [];
  const profiles = useMemo(() => index?.profiles ?? [], [index?.profiles]);

  const currentProfile = useMemo(() => {
    if (!draft) return null;
    const name = (draft.aiName ?? "").trim();
    return profiles.find((p) => p.name === name) ?? null;
  }, [profiles, draft]);

  const evalFiles = useMemo(() => {
    const xs = currentProfile?.eval_files ?? [];
    // nn.bin を先頭に寄せる（残りは entry 昇順のままでもOK）
    const nn = xs.filter((f) => f.entry === "nn.bin");
    const rest = xs.filter((f) => f.entry !== "nn.bin");
    return [...nn, ...rest];
  }, [currentProfile]);

  const bookDbs = useMemo(
    () => currentProfile?.book_db_files ?? [],
    [currentProfile],
  );

  // ---- auto-fill when index becomes available (only if empty or invalid) ----
  useEffect(() => {
    if (!open) return;
    if (!draft) return;
    if (!index) return;

    setDraft((cur) => {
      if (!cur) return cur;

      let next = cur;

      // 1) profile(aiName)
      const curName = (next.aiName ?? "").trim();
      const profileOk = curName && profiles.some((p) => p.name === curName);

      if (!profileOk) {
        const preferred =
          profiles.find((p) => p.has_eval_dir) ?? profiles[0] ?? null;
        if (preferred) {
          next = { ...next, aiName: preferred.name };
        }
      }

      // 2) engine
      const engineOk =
        (next.enginePath ?? "").trim() &&
        engines.some((e) => e.path === next.enginePath);
      if (!engineOk) {
        const first = engines[0] ?? null;
        if (first) {
          next = { ...next, enginePath: first.path };
        }
      }

      // 3) eval file
      const prof =
        profiles.find((p) => p.name === (next.aiName ?? "").trim()) ?? null;
      const evalOk =
        (next.evalFilePath ?? "").trim() &&
        (prof?.eval_files ?? []).some((f) => f.path === next.evalFilePath);

      if (!evalOk) {
        const defEval = pickDefaultEvalFile(prof);
        if (defEval) {
          next = { ...next, evalFilePath: defEval.path };
        } else {
          // クリア
          next = { ...next, evalFilePath: "" };
        }
      }

      // 4) book db (if enabled)
      if (next.bookEnabled) {
        const bookOk =
          (next.bookFilePath ?? "").trim() &&
          (prof?.book_db_files ?? []).some((f) => f.path === next.bookFilePath);

        if (!bookOk) {
          const defBook = pickDefaultBookDb(prof);
          next = { ...next, bookFilePath: defBook ? defBook.path : null };
        }
      } else {
        if (next.bookFilePath != null) next = { ...next, bookFilePath: null };
      }

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!index]);

  const onSave = async () => {
    if (!draft) return;

    const nextErrors: Record<string, string> = {};

    const label = cleanLabel(draft.label);
    if (!label) nextErrors.label = "名前は必須です";

    const aiName = cleanAiName(draft.aiName);
    const enginePath = cleanPath(draft.enginePath);
    const evalFilePath = cleanPath(draft.evalFilePath);

    if (!aiName) nextErrors.aiName = "AI名（プロファイル）を選択してください";
    if (!enginePath) nextErrors.enginePath = "エンジンを選択してください";
    if (!evalFilePath)
      nextErrors.evalFilePath = "評価関数ファイルを選択してください";

    const bookEnabled = Boolean(draft.bookEnabled);
    const bookFilePath = bookEnabled
      ? cleanPath(draft.bookFilePath ?? "") || null
      : null;
    if (bookEnabled && !bookFilePath)
      nextErrors.bookFilePath = "定跡ファイルを選択してください";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // analysis (<=0 は消す)
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

    // options: 空文字は入れない
    const rawOpt = draft.options ?? {};
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawOpt)) {
      const vv = String(v ?? "").trim();
      if (!vv) continue;
      options[k] = vv;
    }

    // MultiPV/Threads/Hash は UI state を優先して確実に反映
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
  };

  const onCreateEnginesDir = async () => {
    if (!aiRoot) return;
    try {
      setIndexStatus("loading");
      await ensureEnginesDir(aiRoot);
      rescan();
    } catch (e) {
      setIndexStatus("error");
      setIndexError(`engines/ の作成に失敗しました: ${String(e)}`);
    }
  };

  if (!open) return null;
  if (!preset || !draft) return null;

  const title = (draft.label ?? "").trim() || "プリセット編集";

  // ---- select options ----
  const profileOptions = profiles.map((p) => {
    const tag = [
      p.has_eval_dir ? null : "evalなし",
      p.has_book_dir ? null : "bookなし",
    ]
      .filter(Boolean)
      .join(" / ");

    return {
      value: p.name,
      label: tag ? `${p.name}（${tag}）` : p.name,
      // eval がないものは “選択不可” にする（見せるなら無効扱い）
      disabled: !p.has_eval_dir,
    };
  });

  const engineOptions = engines.map((e) => ({
    value: e.path,
    label: e.entry,
    disabled: !(e.kind === "file" || e.kind === "symlink"),
  }));

  const evalOptions = evalFiles.map((f) => ({
    value: f.path,
    label: f.entry,
    disabled: !(f.kind === "file" || f.kind === "symlink"),
  }));

  const bookOptions = bookDbs.map((f) => ({
    value: f.path,
    label: f.entry,
    disabled: !(f.kind === "file" || f.kind === "symlink"),
  }));

  const aiRootReady = Boolean(aiRoot);
  const scanReady = indexStatus === "ok" && index != null;

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
        <header className="presetDialog__header">
          <div className="presetDialog__titles">
            <div className="presetDialog__title">{title}</div>
            <div className="presetDialog__subtitle">
              保存時にプリセットが更新され、必要なら自動でエンジンが再起動されます。
            </div>
          </div>
        </header>

        <div className="presetDialog__body">
          {/* ===================== 基本 ===================== */}
          <SSection
            title="基本"
            description="表示名とAI_ROOT / プロファイル選択"
          >
            <div className="presetDialog__grid2">
              <SField
                label="プリセット名"
                htmlFor="preset-label"
                error={errors.label}
              >
                <SInput
                  id="preset-label"
                  value={draft.label}
                  onChange={(e) =>
                    setDraft({ ...draft, label: e.target.value })
                  }
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
                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={() => chooseAiRoot?.()}
                  >
                    AI_ROOT を選択…
                  </SButton>

                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={() => rescan()}
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

                      // profile変更に合わせて eval/book を自動更新
                      const prof =
                        profiles.find((p) => p.name === name) ?? null;
                      const defEval = pickDefaultEvalFile(prof);
                      if (defEval) next.evalFilePath = defEval.path;
                      else next.evalFilePath = "";

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
                        : indexStatus === "loading"
                          ? "スキャン中…"
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
                <SInput
                  value={currentProfile?.path ?? ""}
                  readOnly
                  placeholder="—"
                />
              </SField>
            </div>
          </SSection>

          {/* ===================== エンジン・ファイル ===================== */}
          <SSection
            title="エンジン・ファイル"
            description="ai_root から候補を列挙し、選択だけで絶対パスを自動設定します。"
          >
            {/* engines/ が無いケース */}
            {scanReady && index && !index.engines_dir.exists && (
              <div
                className="presetDialog__hintWarn"
                style={{ marginBottom: 12 }}
              >
                engines/ ディレクトリが存在しません（{index.engines_dir.path}
                ）。
                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                  <SButton
                    variant="primary"
                    size="sm"
                    onClick={onCreateEnginesDir}
                  >
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
                        ? engines.length > 0
                          ? "エンジンを選択"
                          : "候補がありません（engines/にYaneuraOu*を配置）"
                        : indexStatus === "loading"
                          ? "スキャン中…"
                          : "スキャン結果なし"
                  }
                  disabled={!aiRootReady || !scanReady || engines.length === 0}
                  invalid={!!errors.enginePath}
                />
                {!!draft.enginePath && (
                  <div
                    className="presetDialog__hintMuted"
                    style={{ marginTop: 8 }}
                  >
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
                        ? evalFiles.length > 0
                          ? "評価関数ファイルを選択"
                          : "eval/ にファイルがありません"
                        : "このプロファイルには eval/ がありません"
                  }
                  disabled={
                    !currentProfile ||
                    !currentProfile.has_eval_dir ||
                    evalFiles.length === 0
                  }
                  invalid={!!errors.evalFilePath}
                />
                {!!draft.evalFilePath && (
                  <div
                    className="presetDialog__hintMuted"
                    style={{ marginTop: 8 }}
                  >
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
                          // ONにした瞬間、空ならデフォルトを入れる
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
                  <span className="presetDialog__checkLabel">
                    定跡（book）を使う
                  </span>
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
                          ? bookDbs.length > 0
                            ? "定跡ファイルを選択"
                            : "book/ に .db がありません"
                          : "このプロファイルには book/ がありません"
                    }
                    disabled={
                      !currentProfile ||
                      !currentProfile.has_book_dir ||
                      bookDbs.length === 0
                    }
                    invalid={!!errors.bookFilePath}
                  />
                  {!!draft.bookFilePath && (
                    <div
                      className="presetDialog__hintMuted"
                      style={{ marginTop: 8 }}
                    >
                      選択: <b>{basename(draft.bookFilePath)}</b>
                    </div>
                  )}
                </SField>
              )}

              {/* 手動の逃げ道（好みで削除してOK） */}
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

          {/* ===================== 重要オプション（以下は元のまま） ===================== */}
          <SSection
            title="重要オプション"
            description="研究・定跡管理では対局向けの時間調整系は基本不要です（下の折りたたみに隔離）。"
          >
            <div className="presetDialog__stack">
              {/* MultiPV */}
              <div className="presetDialog__block">
                <div className="presetDialog__blockHead">
                  <div className="presetDialog__blockTitle">
                    MultiPV（候補手数）
                  </div>
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
                    onClick={() => setShowMultiPvCustom((v) => !v)}
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
                        onChangeMultiPv(
                          parseIntSafe(e.target.value, MULTIPV_MIN),
                        )
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
                    注意: MultiPV を
                    2以上にすると棋力が低下し得ます（研究用途では “幅 vs 深さ”
                    の調整として有用）。
                  </div>
                )}
              </div>

              {/* Threads */}
              <div className="presetDialog__block">
                <div className="presetDialog__blockHead">
                  <div className="presetDialog__blockTitle">
                    Threads（並列数）
                  </div>
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

            {/* 対局向け（隔離） */}
            <details className="presetDialog__details">
              <summary className="presetDialog__summary">
                対局向け（非推奨）
              </summary>
              <div className="presetDialog__detailsBody">
                <div className="presetDialog__grid2">
                  <SField
                    label="NetworkDelay"
                    description="通信遅延の想定（対局向け）"
                  >
                    <SInput
                      type="number"
                      value={
                        draft.options.NetworkDelay ??
                        DEFAULT_OPTIONS.NetworkDelay
                      }
                      onChange={(e) =>
                        setOpt(
                          "NetworkDelay",
                          String(parseIntSafe(e.target.value, 0)),
                        )
                      }
                    />
                  </SField>

                  <SField
                    label="NetworkDelay2"
                    description="通信遅延2（対局向け）"
                  >
                    <SInput
                      type="number"
                      value={
                        draft.options.NetworkDelay2 ??
                        DEFAULT_OPTIONS.NetworkDelay2
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

                  <SField
                    label="SlowMover"
                    description="秒読み配分（対局向け）"
                  >
                    <SInput
                      type="number"
                      value={
                        draft.options.SlowMover ?? DEFAULT_OPTIONS.SlowMover
                      }
                      onChange={(e) =>
                        setOpt(
                          "SlowMover",
                          String(parseIntSafe(e.target.value, 0)),
                        )
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

          {/* ===================== 解析デフォルト ===================== */}
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
        </div>

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
      </div>
    </Modal>
  );
}
