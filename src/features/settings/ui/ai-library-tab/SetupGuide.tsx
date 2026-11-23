import { AlertTriangle } from "lucide-react";

import type { AiLibraryContents } from "@/features/settings/lib/aiLibraryContents";
import { setupStepStates } from "@/features/settings/lib/setupSteps";
import { useAiFolderForm } from "@/features/settings/model/useAiFolderForm";
import type { ScanState } from "@/features/settings/lib/aiRootScan";
import type { AiLibraryActions } from "@/features/settings/model/useAiLibrary";
import { SFold, SSection } from "../kit";
import { AiFolderForm } from "./AiFolderForm";
import { FoundTable } from "./FoundTable";
import { SetupHero } from "./SetupHero";
import { SetupStatus } from "./SetupStatus";
import { FolderConcept } from "./steps/FolderConcept";
import { Step1SelectRoot } from "./steps/Step1SelectRoot";
import { Step2CreateEngines } from "./steps/Step2CreateEngines";
import { Step3PlaceEngines } from "./steps/Step3PlaceEngines";
import { Step4PlaceAssets } from "./steps/Step4PlaceAssets";
import "./SetupGuide.scss";

type Props = {
  /** ルートが無ければ `null` */
  aiRootPath: string | null;
  scan: ScanState;
  contents: AiLibraryContents;
  actions: AiLibraryActions;
};

export default function SetupGuide({ aiRootPath, scan, contents, actions }: Props) {
  const aiFolderForm = useAiFolderForm(actions.createAiFolder);

  const { enginesDir, engineNames, profiles, warnings } = contents;
  const hasRoot = aiRootPath !== null;
  const scanReady = scan.status === "ready";
  const isScanning = scan.status === "loading";
  const enginesCount = engineNames.length;

  /**
   * AI フォルダを作れるか。「現在の状態」の添え書きと、入力欄が読む。
   *
   * 条件を散らすと、添え書きが作成を指示するのに入力欄が無い、という食い違いが出る。
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

  // 済んでいる説明は閉じておく。やり残しがあるときだけ開く
  const hasTodo = Object.values(steps).some((state) => state !== "done");

  return (
    <div className="setupGuide">
      {/* 「もう一度読み込む」で見つかった問題を読み上げる。領域は問題が無いときから置いておく。
          中身と同じ描画で挿し込むと、読まれるかが実装依存になる（`NotificationLayer` の読み上げの領域と同じ）。
          見える一覧を包まないのは、節どうしの区切り（`SSection.scss` の `& + &`）が隣どうしでしか引かれないため */}
      <p className="setupGuide__announce" role="status">
        {scanReady && warnings.length > 0 ? `検出された問題。${warnings.join("")}` : ""}
      </p>

      {scanReady && warnings.length > 0 && (
        <SSection title="検出された問題">
          <ul className="setupGuide__warnings">
            {warnings.map((warning) => (
              <li key={warning} className="setupGuide__warning">
                <AlertTriangle size={13} aria-hidden="true" />
                <span className="setupGuide__warningItem">{warning}</span>
              </li>
            ))}
          </ul>
        </SSection>
      )}

      <SSection title="次にやること">
        <SetupHero
          hasRoot={hasRoot}
          scan={scan}
          contents={contents}
          actions={actions}
          onFocusAiName={aiFolderForm.focusInput}
        />
      </SSection>

      <SSection title="現在の状態" description="読み込んだ結果をリアルタイムで反映しています。">
        <SetupStatus hasRoot={hasRoot} contents={contents} canCreateProfile={canCreateProfile} />
        {scanReady && <FoundTable engineNames={engineNames} profiles={profiles} />}
      </SSection>

      {canCreateProfile && (
        <SSection
          title="AI フォルダを追加"
          description="AI 名を入力すると eval/ と book/ をまとめて作成します。"
        >
          <AiFolderForm form={aiFolderForm} />
        </SSection>
      )}

      <SFold
        title="フォルダ構成"
        description="この構造でファイルを置くと自動検出されます。"
        defaultOpen={hasTodo}
      >
        <FolderConcept />
      </SFold>

      <SFold title="セットアップ手順" description="手順ごとに操作できます。" defaultOpen={hasTodo}>
        <ol className="setupGuide__steps">
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
        </ol>
      </SFold>
    </div>
  );
}
