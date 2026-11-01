import "./AiLibraryTab.scss";

import { Copy, FolderOpen, Sparkles } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SSection } from "../kit";
import { canCreateEnginesDir, canRevealEnginesDir } from "@/entities/engine/lib/enginesDir";
import { useAiLibrary, type ScanState } from "@/features/settings/model/useAiLibrary";
import { copyText } from "@/shared/api/clipboard/copyText";
import SetupGuide from "../ai-library-tab/SetupGuide";

type Badge = { tone: "ok" | "warn" | "danger" | "muted"; text: string };

function badgeOf(hasRoot: boolean, scan: ScanState, warningCount: number): Badge {
  if (!hasRoot) return { tone: "warn", text: "未設定" };
  switch (scan.status) {
    case "idle":
      return { tone: "muted", text: "—" };
    case "loading":
      return { tone: "muted", text: "診断中…" };
    case "error":
      return { tone: "danger", text: "エラー" };
    case "ready":
      return warningCount > 0 ? { tone: "warn", text: "注意あり" } : { tone: "ok", text: "OK" };
  }
}

export default function AiLibraryTab() {
  const { aiRootPath, scan, contents, actions } = useAiLibrary();

  const { enginesDir, warnings } = contents;
  const hasRoot = aiRootPath.trim().length > 0;
  const badge = badgeOf(hasRoot, scan, warnings.length);

  return (
    <div className="aiLibraryTab">
      <div className="aiLibraryTab__grid">
        <div className="aiLibraryTab__mainCol">
          <SSection
            title="AI ライブラリ"
            description="エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作成して固定）。"
            actions={
              <div className="aiLibraryTab__badge" data-tone={badge.tone}>
                {badge.text}
              </div>
            }
          >
            <SField
              label="フォルダ"
              description="決めたルールのフォルダ構成でファイルを置くと自動検出します。"
              right={
                <div className="aiLibraryTab__fieldActions">
                  <Button tone="accent" size="sm" onClick={actions.selectRoot}>
                    <FolderOpen size={16} style={{ marginRight: 6 }} />
                    選択…
                  </Button>
                  <Button
                    size="sm"
                    onClick={actions.openAiRoot}
                    disabled={!hasRoot}
                    title="Finder/Explorer で開く"
                  >
                    開く
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => copyText(aiRootPath)}
                    disabled={!hasRoot}
                    title="パスをコピー"
                  >
                    <Copy size={16} />
                  </Button>
                </div>
              }
            >
              <SInput
                value={aiRootPath}
                placeholder="未設定（選択… からフォルダを選択してください）"
                readOnly
              />
            </SField>

            <div className="aiLibraryTab__rowActions">
              {canCreateEnginesDir(enginesDir) && (
                <Button
                  tone="accent"
                  size="sm"
                  onClick={actions.createEnginesDir}
                  disabled={scan.status === "loading"}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} />
                  engines/ を作成
                </Button>
              )}
              <Button
                size="sm"
                onClick={actions.openEnginesDir}
                disabled={!canRevealEnginesDir(enginesDir)}
                title="engines/ を開く"
              >
                engines/ を開く
              </Button>
            </div>

            {scan.status === "error" && (
              <div className="aiLibraryTab__error" role="alert">
                {scan.error}
              </div>
            )}
          </SSection>
        </div>

        <SetupGuide
          aiRootPath={aiRootPath || null}
          scan={scan}
          contents={contents}
          actions={actions}
        />
      </div>
    </div>
  );
}
