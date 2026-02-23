import "./PositionNavigationFooter.scss";

function PositionNavigationFooter() {
  return (
    <footer className="position-navigation-modal__footer">
      <div className="position-navigation-modal__shortcuts">
        <span>[h/l] 手順移動/分岐移動</span>
        <span>[j/k] 分岐選択</span>
        <span>[Enter] 確定</span>
        <span>[Esc] キャンセル</span>
      </div>
    </footer>
  );
}

export default PositionNavigationFooter;
