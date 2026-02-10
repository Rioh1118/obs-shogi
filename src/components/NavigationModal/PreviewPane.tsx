import React, { useEffect, useRef, useState } from "react";
import BoardPreview from "../GameBoard/Board/BoardPreview";
import { Color } from "shogi.js";
import type { PreviewData } from "@/types";
import "./PreviewPane.scss";

type Props = {
  previewData: PreviewData | null;
  toKan: (k: string) => string;
};
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const PreviewPane: React.FC<Props> = ({ previewData, toKan }) => {
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(320);

  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      const next = clamp(Math.floor(w - 24 * 10), 240, 520);
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
};

const HandRow: React.FC<{
  label: string;
  kinds: string[];
  toKan: (k: string) => string;
}> = ({ label, kinds, toKan }) => (
  <div className="position-navigation-modal__hand">
    <div className="position-navigation-modal__hand-label">{label}</div>
    <div className="position-navigation-modal__hand-pieces">
      {kinds.length > 0 ? (
        kinds.map((kind, i) => (
          <span
            key={`${label}-${kind}-${i}`}
            className="position-navigation-modal__hand-piece"
          >
            {toKan(kind)}
          </span>
        ))
      ) : (
        <span className="position-navigation-modal__hand-empty">なし</span>
      )}
    </div>
  </div>
);

export default PreviewPane;
