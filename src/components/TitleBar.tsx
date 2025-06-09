import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Maximize2, X } from "lucide-react";
import { useMemo } from "react";
import "./TitleBar.scss";

function TitleBar() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);

  const handleMinimize = () => currentWindow.minimize();
  const handleMaximize = () => currentWindow.toggleMaximize();
  const handleClose = () => currentWindow.close();

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* ボタン領域（ドラッグ無効） */}
      <div className="titlebar__buttons" data-tauri-drag-region="false">
        <button className="close" onClick={handleClose}>
          <X size={12} strokeWidth={3} />
        </button>
        <button className="minimize" onClick={handleMinimize}>
          <Minus size={12} strokeWidth={3} />
        </button>
        <button className="maximize" onClick={handleMaximize}>
          <Maximize2 size={12} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
