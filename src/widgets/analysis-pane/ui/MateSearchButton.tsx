import { Crown, Square } from "lucide-react";
import { isMateSearchRunning, useMateSearch } from "@/entities/mate-search";

/**
 * 詰み探索の開始と中止。検討が走っていることを理由に無効にしない。押した側に切り替える
 * （`docs/spec/features/mate-search.md` の AC-M6 AC-M7）。
 */
export function MateSearchButton({ currentSfen }: { currentSfen: string | null }) {
  const { state, available, toggle } = useMateSearch();
  const running = isMateSearchRunning(state);
  const stopping = "stopping" in state && state.stopping;

  const title = running
    ? "詰み探索を中止"
    : available
      ? "詰み探索"
      : "詰み探索に使うプリセットを設定で選択してください";

  return (
    <button
      className="analysis-controls__iconBtn"
      onClick={() => void toggle()}
      disabled={running ? stopping : !available || !currentSfen}
      title={title}
    >
      {running ? (
        <Square className="analysis-controls__icon" />
      ) : (
        <Crown className="analysis-controls__icon" />
      )}
    </button>
  );
}
