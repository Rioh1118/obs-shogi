import { FolderOpen, RefreshCw } from "lucide-react";
import { SButton } from "../../kit";
import { StepShell, type StepState } from "./StepShell";
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
      ? "エンジンが見つかりませんでした。engines/ を開いて実行ファイルを配置してからスキャンしてください。"
      : "YaneuraOu などのエンジン実行ファイルを engines/ に配置してください。配置後にスキャンします。";

  return (
    <StepShell state={state} title="エンジン実行ファイルを配置" summary={`${enginesCount} 個検出`}>
      <div className="aiLibraryTab__stepDesc">{desc}</div>

      <StepTree>
        <TreeLine label="📂 ai_root/" dim />
        <TreeLine indent={1} label="📂 engines/" dim />
        <TreeLine indent={2} label="🔧 YaneuraOu-xxx" note="← ここに置く" highlight />
        <TreeLine indent={2} label="🔧 …" dim />
      </StepTree>

      <div className="aiLibraryTab__stepAction">
        <SButton variant="ghost" size="sm" onClick={onOpenEnginesDir}>
          <FolderOpen size={14} style={{ marginRight: 6 }} />
          engines/ を開く
        </SButton>
        <SButton variant="subtle" size="sm" onClick={onScan} disabled={isScanning}>
          <RefreshCw size={14} style={{ marginRight: 6 }} />
          スキャン
        </SButton>
      </div>
    </StepShell>
  );
}
