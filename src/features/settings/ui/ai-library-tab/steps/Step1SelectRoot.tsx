import { FolderOpen } from "lucide-react";
import Button from "@/shared/ui/Button/Button";
import type { StepState } from "@/features/settings/lib/setupSteps";
import { StepShell } from "./StepShell";
import { StepTree, TreeLine } from "./StepTree";

type Props = {
  state: StepState;
  /** 見出しの横に出す、詰めたルート */
  shortRoot: string;
  onSelect: () => void;
};

export function Step1SelectRoot({ state, shortRoot, onSelect }: Props) {
  return (
    <StepShell state={state} title="AI ライブラリを選択" summary={shortRoot}>
      <p className="setupGuide__stepDesc">
        エンジン・評価関数・定跡をすべてまとめる専用フォルダを1つ選択します。
        既存フォルダでも新規フォルダでも構いません。
      </p>

      <StepTree>
        <TreeLine label="ai_root/" note="← ここを選択" highlight />
        <TreeLine indent={1} label="engines/" />
        <TreeLine indent={1} label="&lt;AI 名&gt;/" />
      </StepTree>

      <div className="setupGuide__stepAction">
        <Button tone="accent" size="sm" onClick={onSelect}>
          <FolderOpen size={13} aria-hidden="true" />
          フォルダを選択…
        </Button>
      </div>
    </StepShell>
  );
}
