import { Color, type Kind } from "shogi.js";
import PieceFactory from "../PieceFactory";
import { useHandLayout, type RowConfig } from "./useHandLayout";
import "./Hand.scss";
import { useEffect, useState } from "react";
import { useGame } from "@/entities/game";

interface HandProps {
  isSente: boolean;
}

function Hand({ isSente }: HandProps) {
  const { state, selectHand, clearSelection, getCurrentTurn } = useGame();
  const hands = state.jkfPlayer?.shogi.hands;
  const currentTurn = getCurrentTurn();
  const selectedPosition = state.selectedPosition;

  const color = isSente ? Color.Black : Color.White;
  const handPieces = hands?.[color] || [];

  const handPiecesArray = Array.from(handPieces || []);
  const { arrangedPieces, layoutConfig } = useHandLayout(handPiecesArray);
  const isCurrentTurn = color === currentTurn;

  const [selectedHandUi, setSelectedHandUi] = useState<{
    kind: string;
    nth: number;
  } | null>(null);

  const isThisHandSelected =
    selectedPosition?.type === "hand" && selectedPosition.color === color;

  const isSelectedThisPiece = (pieceKind: string, nth: number) => {
    return (
      isThisHandSelected &&
      selectedPosition.kind === pieceKind &&
      selectedHandUi?.kind === pieceKind &&
      selectedHandUi.nth === nth
    );
  };

  useEffect(() => {
    const isThisHandSelected =
      selectedPosition?.type === "hand" && selectedPosition.color === color;

    if (!isThisHandSelected) {
      setSelectedHandUi(null);
      return;
    }

    if (selectedHandUi && selectedHandUi.kind !== selectedPosition.kind) {
      setSelectedHandUi(null);
    }
  }, [selectedPosition, color, selectedHandUi]);

  const handlePieceClick = (pieceKind: string, nth: number) => {
    if (!isCurrentTurn) {
      clearSelection();
      return;
    }

    if (isSelectedThisPiece(pieceKind, nth)) {
      clearSelection();
      return;
    }

    setSelectedHandUi({ kind: pieceKind, nth });
    selectHand(color, pieceKind as Kind);
  };

  const handleHandAreaPointerDown = (e: React.PointerEvent) => {
    if (!state.selectedPosition) return;

    const el = e.target as HTMLElement | null;
    if (!el) return;

    if (el.closest('[data-hand-piece="true"]')) return;

    clearSelection();
  };

  const renderPiecesInRow = (
    pieces: string[],
    rowConfig: RowConfig,
    occ: Map<string, number>,
  ) => {
    return pieces.map((pieceKind) => {
      const nth = occ.get(pieceKind) ?? 0;
      occ.set(pieceKind, nth + 1);

      const isSelectedUI =
        selectedPosition?.type === "hand" &&
        selectedPosition.color === color &&
        selectedPosition.kind === pieceKind &&
        selectedHandUi?.kind === pieceKind &&
        selectedHandUi.nth === nth;

      return (
        <div
          key={`${pieceKind}-${nth}`}
          className={`hand-piece ${isSelectedUI ? "hand-piece--selected" : ""}`}
          data-hand-piece="true"
          style={{
            width: `${rowConfig.pieceSize}em`,
            height: `${rowConfig.pieceSize * 1.1}em`,
          }}
        >
          <PieceFactory
            jkfKind={pieceKind}
            color={color}
            onClick={() => handlePieceClick(pieceKind, nth)}
          />
        </div>
      );
    });
  };

  const occ = new Map<string, number>();

  return (
    <div
      className={`hand-container ${isSente ? "player-hand" : "opponent-hand"}`}
      data-hand-area="true"
      onPointerDown={handleHandAreaPointerDown}
    >
      <div className="hand-pieces">
        {(isSente
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
                gap: `${rowConfig.gap}em`,
                justifyContent: "center",
              }}
            >
              {renderPiecesInRow(pieces, rowConfig, occ)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Hand;
