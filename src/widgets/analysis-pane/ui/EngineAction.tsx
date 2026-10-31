import { Play, Square } from "lucide-react";
import type { EngineStatus } from "@/entities/analysis";
import Button from "@/shared/ui/Button/Button";

type Props = {
  status: EngineStatus;
  isAnalyzing: boolean;
  /** 読む局面があるか */
  canStart: boolean;
  onToggle: () => void;
  onRestart: () => void;
};

/**
 * ▶ の位置に出る1つのボタン。**いまの状態の次の一手を出す**
 * （`docs/spec/features/engine-standardization.md` の「エンジンの状態」）。
 */
export function EngineAction({ status, isAnalyzing, canStart, onToggle, onRestart }: Props) {
  if (status === "exited" || status === "unresponsive") {
    return (
      <Button size="sm" motion={false} onClick={onRestart}>
        再起動する
      </Button>
    );
  }

  return (
    <button
      className="analysis-controls__iconBtn"
      onClick={onToggle}
      disabled={!isAnalyzing && !canStart}
      title={isAnalyzing ? "検討を中断" : "検討を開始"}
    >
      {isAnalyzing ? (
        <Square className="analysis-controls__icon" />
      ) : (
        <Play className="analysis-controls__icon" />
      )}
    </button>
  );
}
