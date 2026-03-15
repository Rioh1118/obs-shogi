import { Sparkles } from "lucide-react";
import { SButton } from "../../kit";
import { StepShell, type StepState } from "./StepShell";
import { StepTree, TreeLine } from "./StepTree";

type Props = {
  state: StepState;
  isScanning: boolean;
  onCreateEnginesDir: () => void;
};

export function Step2CreateEngines({
  state,
  isScanning,
  onCreateEnginesDir,
}: Props) {
  return (
    <StepShell
      state={state}
      title="engines/ フォルダを作成"
      summary="engines/ 検出済み"
    >
      <div className="aiLibraryTab__stepDesc">
        エンジン実行ファイルをまとめる <code>engines/</code>{" "}
        フォルダをボタンひとつで作成します。
      </div>

      <StepTree>
        <TreeLine label="📂 ai_root/" dim />
        <TreeLine indent={1} label="📂 engines/" note="← 作成される" highlight />
      </StepTree>

      <div className="aiLibraryTab__stepAction">
        <SButton
          variant="subtle"
          size="sm"
          onClick={onCreateEnginesDir}
          disabled={isScanning}
        >
          <Sparkles size={14} style={{ marginRight: 6 }} />
          engines/ を作成
        </SButton>
      </div>
    </StepShell>
  );
}
