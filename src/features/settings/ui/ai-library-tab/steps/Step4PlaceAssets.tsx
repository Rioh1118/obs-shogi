import { RefreshCw } from "lucide-react";
import { SButton } from "../../kit";
import { StepShell, type StepState } from "./StepShell";
import { StepTree, TreeLine } from "./StepTree";

type Props = {
  state: StepState;
  profilesCount: number;
  isScanning: boolean;
  onScan: () => void;
};

export function Step4PlaceAssets({ state, profilesCount, isScanning, onScan }: Props) {
  return (
    <StepShell state={state} title="評価関数・定跡を配置" summary={`${profilesCount} 個のAI検出`}>
      <div className="aiLibraryTab__stepDesc">
        AI名のフォルダを作り、その中に <code>eval/</code> と <code>book/</code>{" "}
        を置きます。フォルダ名がそのままプリセット名になります。
      </div>

      <StepTree>
        <TreeLine label="📂 ai_root/" dim />
        <TreeLine indent={1} label="📂 &lt;AI名&gt;/" highlight note="← 任意の名前" />
        <TreeLine indent={2} label="📂 eval/" highlight />
        <TreeLine indent={3} label="📄 nn.bin" note="← 評価関数" highlight />
        <TreeLine indent={2} label="📂 book/" highlight />
        <TreeLine indent={3} label="📄 book.db" note="← 定跡DB" highlight />
      </StepTree>

      <div className="aiLibraryTab__stepAction">
        <SButton variant="subtle" size="sm" onClick={onScan} disabled={isScanning}>
          <RefreshCw size={14} style={{ marginRight: 6 }} />
          スキャン
        </SButton>
      </div>
    </StepShell>
  );
}
