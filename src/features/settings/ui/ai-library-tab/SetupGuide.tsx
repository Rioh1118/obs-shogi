import { AlertTriangle } from "lucide-react";

import type { AiFolderSummary, AiLibraryContents } from "@/features/settings/lib/aiLibraryContents";
import { setupStepStates } from "@/features/settings/lib/setupSteps";
import { useAiFolderForm } from "@/features/settings/model/useAiFolderForm";
import type { AiLibraryActions, ScanState } from "@/features/settings/model/useAiLibrary";
import { SSection } from "../kit";
import SettingsBadge from "../kit/SettingsBadge";
import { AiFolderForm } from "./AiFolderForm";
import { SetupHero } from "./SetupHero";
import { SetupStatusGrid } from "./SetupStatusGrid";
import { FolderConcept } from "./steps/FolderConcept";
import { Step1SelectRoot } from "./steps/Step1SelectRoot";
import { Step2CreateEngines } from "./steps/Step2CreateEngines";
import { Step3PlaceEngines } from "./steps/Step3PlaceEngines";
import { Step4PlaceAssets } from "./steps/Step4PlaceAssets";
import { StructureOverview } from "./steps/StructureOverview";
import "./SetupGuide.scss";

type Props = {
  /** ルートが無ければ `null` */
  aiRootPath: string | null;
  scan: ScanState;
  contents: AiLibraryContents;
  actions: AiLibraryActions;
};

function ProfileItem({ profile }: { profile: AiFolderSummary }) {
  return (
    <div className="setupGuide__profileItem">
      <div className="setupGuide__profileHead">
        <span className="setupGuide__profileName">{profile.name}</span>
        <div className="setupGuide__profileBadges">
          <SettingsBadge tone={profile.hasEval ? "accent" : "warn"} shape="pill">
            評価関数 {profile.hasEval ? "あり" : "不足"}
          </SettingsBadge>
          <SettingsBadge tone={profile.hasBook ? "accent" : "muted"} shape="pill">
            定跡 {profile.hasBook ? "あり" : "未設定"}
          </SettingsBadge>
        </div>
      </div>
      <div className="setupGuide__profilePath">{profile.path}</div>
    </div>
  );
}

export default function SetupGuide({ aiRootPath, scan, contents, actions }: Props) {
  const aiFolderForm = useAiFolderForm(actions.createAiFolder);

  const { enginesDir, engineNames, profiles, warnings } = contents;
  const hasRoot = aiRootPath !== null;
  const scanReady = scan.status === "ready";
  const isScanning = scan.status === "loading";
  const enginesCount = engineNames.length;

  /**
   * AI フォルダを作れるか。カードのヒント、入力欄、「現在の状態」の木の3か所が読む。
   *
   * 条件を散らすと、木が作成を指示するのに入力欄が無い、という食い違いが出る。
   *
   * TODO(#475): エンジンを置く前に AI フォルダだけ作りたい人を `enginesCount > 0` が止めている
   */
  const canCreateProfile = enginesCount > 0;

  const steps = setupStepStates({
    hasRoot,
    enginesDir,
    engineCount: enginesCount,
    folderCount: profiles.length,
    scanReady,
  });

  const rootPath = aiRootPath ?? "";
  const shortRoot = rootPath.length > 32 ? "…" + rootPath.slice(-31) : rootPath;

  return (
    <div className="setupGuide">
      <SetupHero
        hasRoot={hasRoot}
        scan={scan}
        contents={contents}
        actions={actions}
        onFocusAiName={aiFolderForm.focusInput}
      />

      <SetupStatusGrid
        hasRoot={hasRoot}
        shortRoot={shortRoot}
        contents={contents}
        canCreateProfile={canCreateProfile}
      />

      <SSection title="フォルダ構成" description="この構造でファイルを置くと自動検出されます。">
        <FolderConcept />
      </SSection>

      <SSection title="現在の状態" description="読み込んだ結果をリアルタイムで反映しています。">
        <StructureOverview
          aiRootPath={aiRootPath}
          enginesDir={enginesDir}
          canCreateProfile={canCreateProfile}
          engineNames={engineNames}
          profiles={profiles}
        />
      </SSection>

      <SSection title="セットアップ手順" description="手順ごとに操作できます。">
        <div className="setupGuide__steps">
          <Step1SelectRoot
            state={steps.selectRoot}
            shortRoot={shortRoot}
            onSelect={actions.selectRoot}
          />
          <Step2CreateEngines
            state={steps.createEngines}
            isScanning={isScanning}
            onCreateEnginesDir={actions.createEnginesDir}
          />
          <Step3PlaceEngines
            state={steps.placeEngines}
            enginesCount={enginesCount}
            isScanning={isScanning}
            scanReady={scanReady}
            onOpenEnginesDir={actions.openEnginesDir}
            onScan={actions.rescan}
          />
          <Step4PlaceAssets
            state={steps.placeAssets}
            profilesCount={profiles.length}
            isScanning={isScanning}
            onScan={actions.rescan}
          />
        </div>
      </SSection>

      {canCreateProfile && (
        <SSection
          title="AI フォルダを追加"
          description="AI 名を入力すると eval/ と book/ をまとめて作成します。"
        >
          <AiFolderForm form={aiFolderForm} />
        </SSection>
      )}

      {scanReady && profiles.length > 0 && (
        <SSection title="検出されたAI" description="読み込んだ結果です。">
          <div className="setupGuide__profileList">
            {profiles.map((p) => (
              <ProfileItem key={p.path} profile={p} />
            ))}
          </div>
        </SSection>
      )}

      {scanReady && warnings.length > 0 && (
        <div className="setupGuide__warnings" role="status">
          <div className="setupGuide__warningsTitle">
            <AlertTriangle size={13} />
            検出された問題
          </div>
          {warnings.map((warning) => (
            <div key={warning} className="setupGuide__warningItem">
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
