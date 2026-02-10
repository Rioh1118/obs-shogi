import type { PreviewData } from "@/types";
import "./StatusTips.scss";

type Props = {
  previewData: PreviewData | null;
  selectedBranchIndex: number;
};

export default function StatusTips({
  previewData,
  selectedBranchIndex,
}: Props) {
  const tesuu = previewData?.tesuu ?? 0;
  const turn = previewData?.turn === 0 ? "先手" : "後手";
  const sel = selectedBranchIndex === 0 ? "本譜" : `変化${selectedBranchIndex}`;

  return (
    <div
      className="position-navigation-modal__status-tips"
      aria-label="局面ステータス"
    >
      <span className="position-navigation-modal__chip">{tesuu}手目</span>
      <span className="position-navigation-modal__chip">手番: {turn}</span>
      <span className="position-navigation-modal__chip position-navigation-modal__chip--accent">
        選択:{sel}
      </span>
    </div>
  );
}
