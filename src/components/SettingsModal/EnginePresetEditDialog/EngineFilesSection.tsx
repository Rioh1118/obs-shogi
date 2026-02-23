import type { Dispatch, SetStateAction } from "react";

import type { AiRootIndex, ProfileCandidate } from "@/commands/ai_library";
import { SButton, SField, SInput, SSection, SSelect } from "../ui";
import {
  basename,
  cleanText,
  pickDefaultBookDb,
} from "@/utils/enginePresetDialog";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

export default function EngineFilesSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
  errors: Record<string, string>;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
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
                        (p) => p.name === cleanText(next.aiName ?? ""),
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
