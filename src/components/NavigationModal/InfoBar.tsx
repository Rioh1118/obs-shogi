import type { NavigationState } from "./PositionNavigationModal";
import type { PreviewData } from "@/types";

type Props = {
  previewData: PreviewData | null;
  selectedBranchIndex: number;
};

export default function InfoBar({ previewData, selectedBranchIndex }: Props) {
  const tesuu = previewData?.tesuu ?? 0;
  const turn = previewData?.turn === 0 ? "先手" : "後手";

  return (
    <div className="position-navigation-modal__info-bar">
      <span>手数: {tesuu}手目</span>
      <span>手番: {turn}</span>
      <span>
        選択:{" "}
        {selectedBranchIndex === 0 ? "本譜" : `変化${selectedBranchIndex}`}
      </span>
    </div>
  );
}
