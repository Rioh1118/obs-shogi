import { Crown, Square } from "lucide-react";
import {
  isMateSearchRunning,
  useMateSearch,
  type MateSearchAvailability,
} from "@/entities/mate-search";

const START_TITLE: Record<MateSearchAvailability, string> = {
  ready: "詰み探索",
  unset: "詰み探索に使うプリセットを設定で選択してください",
  incomplete: "詰み探索に使うプリセットのエンジンを設定で選択してください",
};

/**
 * 詰み探索の開始と中止。検討が走っていることを理由に無効にしない。押した側に切り替える
 * （`docs/spec/features/mate-search.md` の AC-M6 AC-M7）。
 */
export function MateSearchButton({ currentSfen }: { currentSfen: string | null }) {
  const { state, availability, toggle } = useMateSearch();
  const running = isMateSearchRunning(state);
  const stopping = "stopping" in state && state.stopping;

  const title = running ? "詰み探索を中止" : START_TITLE[availability];

  return (
    <button
      className="analysis-controls__iconBtn"
      onClick={() => void toggle()}
      disabled={running ? stopping : availability !== "ready" || !currentSfen}
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
