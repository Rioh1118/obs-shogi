import "./GeneralTab.scss";
import {
  SButton,
  SField,
  SInput,
  SSection,
} from "@/components/SettingsModal/ui";

type Props = {
  aiRoot: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onChooseAiRoot: () => Promise<string | null>;
  onClearAiRoot: () => Promise<void>;
};

export default function GeneralTab(props: Props) {
  const { aiRoot, loading, error, onRefresh, onChooseAiRoot, onClearAiRoot } =
    props;

  const hasAiRoot = !!aiRoot;

  return (
    <div className="st-general">
      <SSection
        title="ai_root（AIライブラリ）"
        description="エンジン/プロファイル/解析は ai_root の中身を参照します。"
        actions={
          <div className="st-general__actions">
            <SButton
              variant="primary"
              disabled={loading}
              onClick={() => onChooseAiRoot()}
            >
              フォルダを選択
            </SButton>
            <SButton
              variant="ghost"
              disabled={loading || !hasAiRoot}
              onClick={() => onClearAiRoot()}
            >
              解除
            </SButton>
            <SButton
              variant="subtle"
              disabled={loading}
              onClick={() => onRefresh()}
            >
              再読込
            </SButton>
          </div>
        }
      >
        <SField
          label="現在の ai_root"
          hint={
            !hasAiRoot
              ? "未設定です。まずフォルダを選択してください。"
              : undefined
          }
          error={error || undefined}
        >
          {/* readOnlyで表示だけ統一 */}
          <SInput value={aiRoot ?? ""} readOnly placeholder="(未設定)" />
        </SField>
      </SSection>

      <SSection
        title="期待する構成"
        description="ai_root 配下のディレクトリ構成の目安です。"
      >
        <pre className="st-general__tree">
          {`ai_root/
  engines/
    <engine files...>
  <profile name>/
    eval/nn.bin
    book/<some>.db`}
        </pre>
      </SSection>
    </div>
  );
}
