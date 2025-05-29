import { useGame } from "../../../contexts/GameContext";
import { Color, type Kind } from "shogi.js";
import PieceFactory from "../PieceFactory";
import { useHandLayout, type RowConfig } from "./useHandLayout";
import "./Hand.scss";

interface HandProps {
  isPlayer: boolean;
}

function Hand({ isPlayer }: HandProps) {
  const { getCurrentHands, selectHand } = useGame();
  const hands = getCurrentHands();

  const color = isPlayer ? Color.Black : Color.White;
  const handPieces = hands?.[color] || [];

  const { arrangedPieces, layoutConfig } = useHandLayout(handPieces);

  const renderPiecesInRow = (pieces: string[], rowConfig: RowConfig) => {
    return pieces.map((pieceKind, index) => (
      <div
        key={`${pieceKind}-${index}`}
        className="hand-piece"
        style={{
          width: `${rowConfig.pieceSize}rem`,
          height: `${rowConfig.pieceSize * 1.1}rem`,
        }}
      >
        <PieceFactory
          jkfKind={pieceKind}
          color={color}
          onClick={() => selectHand(color, pieceKind as Kind)}
        />
      </div>
    ));
  };

  return (
    <div
      className={`hand-container ${isPlayer ? "player-hand" : "opponent-hand"}`}
    >
      <div className="hand-pieces">
        {(isPlayer
          ? ["row1", "row2", "row3", "row4"]
          : ["row4", "row3", "row2", "row1"]
        ).map((rowKey) => {
          const pieces = arrangedPieces[rowKey as keyof typeof arrangedPieces];
          const rowConfig = layoutConfig.getRowConfig(pieces);

          return (
            <div
              key={rowKey}
              className={`hand-row hand-${rowKey}`}
              style={{
                gap: `${rowConfig.gap}rem`,
                justifyContent: "center",
              }}
            >
              {renderPiecesInRow(pieces, rowConfig)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Hand;
