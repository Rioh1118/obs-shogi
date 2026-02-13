import "./EngineValidationBanner.scss";
import type { EngineValidation } from "@/types/ai_validation";
import { SButton, SSection } from "@/components/SettingsModal/ui";

type Props = {
  aiLibraryDir: string | null;
  validation: EngineValidation;
  onGoGeneral: () => void;
  onGoEngine: () => void;
  onGoProfile: () => void;
};

export default function EngineValidationBanner({
  aiLibraryDir,
  validation,
  onGoGeneral,
  onGoEngine,
  onGoProfile,
}: Props) {
  if (validation.status === "ok") return null;

  const isChecking = validation.status === "checking";
  const issues = validation.issues ?? [];

  return (
    <div className="st-evb">
      <SSection
        tone="danger"
        title={
          <span className="st-evb__title">
            ⚠️ 起動できません{" "}
            {isChecking && (
              <span className="st-evb__checking">(チェック中...)</span>
            )}
          </span>
        }
        description="設定またはファイルが不足しています。以下を確認してください。"
        actions={
          <div className="st-evb__actions">
            <SButton variant="subtle" onClick={onGoEngine}>
              エンジン選択へ
            </SButton>
            <SButton variant="subtle" onClick={onGoProfile}>
              プロファイル選択へ
            </SButton>
            <SButton variant="primary" onClick={onGoGeneral}>
              {aiLibraryDir ? "ai_root確認へ" : "ai_root設定へ"}
            </SButton>
          </div>
        }
      >
        {issues.length > 0 ? (
          <ul className="st-evb__list">
            {issues.map((it, i) => (
              <li key={i} className="st-evb__item">
                <div className="st-evb__line">
                  <code className="st-evb__code">{it.code}</code>
                  <span className="st-evb__msg">{it.message}</span>
                </div>
                {it.path && (
                  <div className="st-evb__path">
                    <code>{it.path}</code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="st-evb__empty">詳細情報を取得できませんでした。</div>
        )}

        <div className="st-evb__note">
          ※ “候補一覧” は UI の補助です。最終的な起動可否は EngineContext の{" "}
          <code>validation</code> が決めます。
        </div>
      </SSection>
    </div>
  );
}
