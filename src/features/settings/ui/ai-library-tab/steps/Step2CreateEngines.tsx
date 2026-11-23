import { Sparkles } from "lucide-react";
import Button from "@/shared/ui/Button/Button";
import type { StepState } from "@/features/settings/lib/setupSteps";
import { StepShell } from "./StepShell";
import { StepTree, TreeLine } from "./StepTree";

type Props = {
  state: StepState;
  isScanning: boolean;
  onCreateEnginesDir: () => void;
};

export function Step2CreateEngines({ state, isScanning, onCreateEnginesDir }: Props) {
  return (
    <StepShell state={state} title="engines/ フォルダを作成" summary="engines/ 検出済み">
      <p className="setupGuide__stepDesc">
        エンジン実行ファイルをまとめる <code>engines/</code> フォルダをボタンひとつで作成します。
      </p>

      <StepTree>
        <TreeLine label="ai_root/" />
        <TreeLine indent={1} label="engines/" note="← 作成される" highlight />
      </StepTree>

      <div className="setupGuide__stepAction">
        <Button tone="accent" size="sm" onClick={onCreateEnginesDir} disabled={isScanning}>
          <Sparkles size={13} aria-hidden="true" />
          engines/ を作成
        </Button>
      </div>
    </StepShell>
  );
}
