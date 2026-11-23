import { FolderOpen, RefreshCw } from "lucide-react";
import Button from "@/shared/ui/Button/Button";
import type { StepState } from "@/features/settings/lib/setupSteps";
import { StepShell } from "./StepShell";
import { StepTree, TreeLine } from "./StepTree";

type Props = {
  state: StepState;
  enginesCount: number;
  isScanning: boolean;
  scanReady: boolean;
  onOpenEnginesDir: () => void;
  onScan: () => void;
};

export function Step3PlaceEngines({
  state,
  enginesCount,
  isScanning,
  scanReady,
  onOpenEnginesDir,
  onScan,
}: Props) {
  const desc =
    scanReady && enginesCount === 0
      ? "エンジンが見つかりませんでした。engines/ の場所を表示するので、その中に実行ファイルを置いてから、もう一度読み込んでください。"
      : "YaneuraOu などのエンジン実行ファイルを engines/ に配置してください。配置後にもう一度読み込みます。";

  return (
    <StepShell state={state} title="エンジン実行ファイルを配置" summary={`${enginesCount} 個検出`}>
      <p className="setupGuide__stepDesc">{desc}</p>

      <StepTree>
        <TreeLine label="ai_root/" />
        <TreeLine indent={1} label="engines/" />
        <TreeLine indent={2} label="YaneuraOu-xxx" note="← ここに置く" highlight />
        <TreeLine indent={2} label="…" />
      </StepTree>

      <div className="setupGuide__stepAction">
        <Button size="sm" onClick={onOpenEnginesDir}>
          <FolderOpen size={13} aria-hidden="true" />
          engines/ を開く
        </Button>
        <Button size="sm" onClick={onScan} disabled={isScanning}>
          <RefreshCw size={13} aria-hidden="true" />
          もう一度読み込む
        </Button>
      </div>
    </StepShell>
  );
}
