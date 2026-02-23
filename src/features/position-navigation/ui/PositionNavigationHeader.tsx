import StatusTips from "./StatusTips";
import "./PositionNavigationHeader.scss";
import type { PreviewData } from "@/entities/position/model/preview";

type Props = {
  previewData: PreviewData | null;
  selectedBranchIndex: number;
};

function PositionNavigationHeader({ previewData, selectedBranchIndex }: Props) {
  return (
    <header className="position-navigation-modal__header">
      <div className="position-navigation-modal__header-left">
        <h2 className="position-navigation-modal__title">局面ナビゲーション</h2>
        <p className="position-navigation-modal__subtitle">
          nvim風操作で高速ナビゲーション
        </p>
      </div>
      <div className="position-navigation-modal__header-right">
        <StatusTips
          previewData={previewData}
          selectedBranchIndex={selectedBranchIndex}
        />
      </div>
    </header>
  );
}

export default PositionNavigationHeader;
