import { useEffect, useRef, useState } from "react";
import BoardPreview from "../GameBoard/Board/BoardPreview";
import { Color } from "shogi.js";
import type { PreviewData } from "@/types";
import "./PreviewPane.scss";
import HandRow from "./HandRow";

type Props = {
  previewData: PreviewData | null;
  toKan: (k: string) => string;
};
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

function PreviewPane({ previewData, toKan }: Props) {
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(320);

  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      const style = getComputedStyle(el);
      const padX =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const usable = Math.floor(
        Math.min(rect.width - padX, rect.height - padY),
      );

      const next = clamp(usable, 240, 820);
      setBoardSize(next);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!previewData) {
    return (
      <div className="position-navigation-modal__preview-container">
        <div className="position-navigation-modal__board-preview">
          <div className="board-preview-placeholder">
            <p>局面を読み込み中...</p>
          </div>
        </div>
      </div>
    );
  }

  const hands = (previewData.hands ?? []) as {
    [Color.Black]: string[];
    [Color.White]: string[];
  };

  return (
    <div className="position-navigation-modal__preview-container">
      <div
        className="position-navigation-modal__board-preview"
        ref={boardWrapRef}
      >
        <BoardPreview
          pieces={previewData.board}
          hands={hands}
          size={boardSize}
          showCoordinates={false}
          showLastMove={false}
          showHands={false}
          interactive={false}
        />
      </div>

      <div className="position-navigation-modal__hands">
        <HandRow label="☗先手" kinds={hands[Color.Black] || []} toKan={toKan} />
        <HandRow label="☖後手" kinds={hands[Color.White] || []} toKan={toKan} />
      </div>
    </div>
  );
}

export default PreviewPane;
