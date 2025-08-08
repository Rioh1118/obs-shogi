import React from "react";
import BoardPreview from "../GameBoard/Board/BoardPreview";
import { Color } from "shogi.js";
import type { PreviewData } from "@/types/branchNav";

type Props = {
  previewData: PreviewData | null;
  toKan: (k: string) => string;
};

const PreviewPane: React.FC<Props> = ({ previewData, toKan }) => {
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
      <div className="position-navigation-modal__board-preview">
        <BoardPreview
          pieces={previewData.board}
          hands={hands}
          size={160}
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
