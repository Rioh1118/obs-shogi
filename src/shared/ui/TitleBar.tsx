import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Maximize2, X } from "lucide-react";
import { useMemo, type Ref } from "react";
import "./TitleBar.scss";

type Props = {
  /** 画面が見出しを描く所（`TitleBarContent`） */
  slotRef?: Ref<HTMLDivElement>;
};

/**
 * ウィンドウを動かす帯。操作のボタンと、画面が見出しを描く所を持つ。
 *
 * `deep` なので、見出しの文字の上でもウィンドウを動かせる。ボタンの上では動かない。
 */
function TitleBar({ slotRef }: Props) {
  const currentWindow = useMemo(() => getCurrentWindow(), []);

  const handleMinimize = () => currentWindow.minimize();
  const handleMaximize = () => currentWindow.toggleMaximize();
  const handleClose = () => currentWindow.close();

  return (
    <div className="titlebar" data-tauri-drag-region="deep">
      {/* ボタン領域（ドラッグ無効） */}
      <div className="titlebar__buttons" data-tauri-drag-region="false">
        <button
          type="button"
          className="close"
          aria-label="ウィンドウを閉じる"
          onClick={handleClose}
        >
          <X size={12} strokeWidth={3} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="minimize"
          aria-label="ウィンドウを最小化"
          onClick={handleMinimize}
        >
          <Minus size={12} strokeWidth={3} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="maximize"
          aria-label="ウィンドウを最大化"
          onClick={handleMaximize}
        >
          <Maximize2 size={12} strokeWidth={3} aria-hidden="true" />
        </button>
      </div>

      <div className="titlebar__slot" ref={slotRef} />
    </div>
  );
}

export default TitleBar;
