import type { EngineValidation } from "@/types/ai_validation";

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

  const issues = validation.issues ?? [];
  const isChecking = validation.status === "checking";

  return (
    <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <strong style={{ color: "tomato" }}>⚠️ 起動できません</strong>
        {isChecking && <span style={{ opacity: 0.7 }}>(チェック中...)</span>}
      </div>

      <p style={{ margin: "8px 0 0", opacity: 0.9 }}>
        設定またはファイルが不足しています。以下を確認してください：
      </p>

      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {issues.map((it, i) => (
          <li key={i}>
            <code>{it.code}</code>: {it.message}
            {it.path ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                <code>{it.path}</code>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={onGoEngine}>エンジン選択へ</button>
        <button onClick={onGoProfile}>プロファイル選択へ</button>
        <button onClick={onGoGeneral}>
          {aiLibraryDir ? "ai_root確認へ" : "ai_root設定へ"}
        </button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
        ※ “候補一覧” は UI の補助です。最終的な起動可否は EngineContext の
        validation が決めます。
      </div>
    </div>
  );
}
