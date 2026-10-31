import { Play, Square } from "lucide-react";
import type { EngineStatus } from "@/entities/analysis";
import Button from "@/shared/ui/Button/Button";

type Props = {
  status: EngineStatus;
  isAnalyzing: boolean;
  /** 中断を頼んだ後、エンジンが止まるまで */
  stopping: boolean;
  /** 読む局面があるか */
  canStart: boolean;
  /** 同じ設定のまま起動し直して直る見込みがあるか（`engineFailureNoticeOf` の `retry`） */
  retry: boolean;
  /** 起動が長引いている（`SLOW_START_MS`） */
  slowStart: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onCancelStart: () => void;
};

/**
 * ▶ の位置に出る1つのボタン。**いまの状態の次の一手を出す**
 * （`docs/spec/features/engine-standardization.md` の「エンジンの状態」）。
 */
export function EngineAction({
  status,
  isAnalyzing,
  stopping,
  canStart,
  retry,
  slowStart,
  onToggle,
  onRestart,
  onOpenSettings,
  onCancelStart,
}: Props) {
  if (status === "exited" || status === "unresponsive") {
    return <TextAction label="再起動する" onClick={onRestart} />;
  }
  if (status === "failed" || status === "cancelled") {
    return retry ? (
      <TextAction label="もう一度起動" onClick={onRestart} />
    ) : (
      <TextAction label="設定を開く" onClick={onOpenSettings} />
    );
  }
  if (status === "starting" && slowStart) {
    return <TextAction label="起動を中止する" onClick={onCancelStart} />;
  }

  return (
    <button
      className="analysis-controls__iconBtn"
      onClick={onToggle}
      disabled={stopping || status === "no-engine" || (!isAnalyzing && !canStart)}
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

function TextAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" motion={false} onClick={onClick}>
      {label}
    </Button>
  );
}
