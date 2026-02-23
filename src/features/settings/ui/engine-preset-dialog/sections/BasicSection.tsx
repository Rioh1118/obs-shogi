import { useMemo, type Dispatch, type SetStateAction } from "react";

import type { ProfileCandidate } from "@/commands/ai_library";
import { SButton, SField, SInput, SSection, SSelect } from "../../kit";
import {
  pickDefaultBookDb,
  pickDefaultEvalFile,
} from "@/features/settings/lib/presetDialog";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

export default function BasicSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
  errors: Record<string, string>;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
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
