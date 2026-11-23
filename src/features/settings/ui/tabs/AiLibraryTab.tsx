import { Copy, FolderOpen, Sparkles } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import { SField, SPath, SSection } from "../kit";
import SettingsBadge from "../kit/SettingsBadge";
import { canCreateEnginesDir, canRevealEnginesDir } from "@/entities/ai-library/lib/enginesDir";
import type { ScanState } from "@/features/settings/lib/aiRootScan";
import { useAiLibrary } from "@/features/settings/model/useAiLibrary";
import { copyText } from "@/shared/api/clipboard/copyText";
import SetupGuide from "../ai-library-tab/SetupGuide";
import "./AiLibraryTab.scss";

type Badge = { tone: "warn" | "danger" | "muted"; text: string };

/** 題に添える1語。うまくいっている間は何も言わない */
function badgeOf(hasRoot: boolean, scan: ScanState, warningCount: number): Badge | null {
  if (!hasRoot) return { tone: "warn", text: "未設定" };
  switch (scan.status) {
    case "idle":
      return null;
    case "loading":
      return { tone: "muted", text: "診断中…" };
    case "error":
      return { tone: "danger", text: "エラー" };
    case "ready":
      return warningCount > 0 ? { tone: "warn", text: "注意あり" } : null;
  }
}

export default function AiLibraryTab() {
  const { aiRootPath, scan, contents, actions } = useAiLibrary();

  const { enginesDir, warnings } = contents;
  const hasRoot = aiRootPath.trim().length > 0;
  const badge = badgeOf(hasRoot, scan, warnings.length);

  return (
    <div className="aiLibraryTab">
      <SSection
        title="AI ライブラリ"
        badge={badge && <SettingsBadge tone={badge.tone}>{badge.text}</SettingsBadge>}
        description="エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作成して固定）。"
      >
        <SField
          label="フォルダ"
          description="決めたルールのフォルダ構成でファイルを置くと自動検出します。"
        >
          <div className="aiLibraryTab__folder">
            <SPath path={aiRootPath} placeholder="未設定（選択… からフォルダを選択してください）" />

            {/* 欄（パス）と同じ行に並ぶので、欄と同じ高さの md にする */}
            <div className="aiLibraryTab__actions">
              <Button tone="accent" size="md" onClick={actions.selectRoot}>
                <FolderOpen size={13} aria-hidden="true" />
                選択…
              </Button>
              <Button
                size="md"
                onClick={actions.openAiRoot}
                disabled={!hasRoot}
                title="Finder/Explorer で開く"
              >
                開く
              </Button>
              {canCreateEnginesDir(enginesDir) && (
                <Button
                  tone="accent"
                  size="md"
                  onClick={actions.createEnginesDir}
                  disabled={scan.status === "loading"}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  engines/ を作成
                </Button>
              )}
              <Button
                size="md"
                onClick={actions.openEnginesDir}
                disabled={!canRevealEnginesDir(enginesDir)}
                title="engines/ を開く"
              >
                engines/ を開く
              </Button>
              {/* パスの行の押すものは、ワークスペースのパスの行と同じ形（語つき）にする */}
              <Button size="md" onClick={() => copyText(aiRootPath)} disabled={!hasRoot}>
                <Copy size={13} aria-hidden="true" />
                コピー
              </Button>
            </div>
          </div>
        </SField>

        {scan.status === "error" && (
          <p className="aiLibraryTab__error" role="alert">
            {scan.error}
          </p>
        )}
      </SSection>

      <SetupGuide
        aiRootPath={aiRootPath || null}
        scan={scan}
        contents={contents}
        actions={actions}
      />
    </div>
  );
}
