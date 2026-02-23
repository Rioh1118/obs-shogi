import { CornerDownLeft } from "lucide-react";
import "./PositionSearchModalFooter.scss";

export default function PositionSearchModalFooter() {
  return (
    <footer className="pos-search__footer">
      <div className="pos-search__hint">
        <CornerDownLeft size={14} />
        <span>Enter: 移動 / j,k: 選択 / Esc: 閉じる</span>
      </div>
    </footer>
  );
}
