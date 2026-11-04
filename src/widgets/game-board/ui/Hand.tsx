import { Color, type Kind } from "shogi.js";
import PieceImage from "@/entities/position/ui/PieceImage";
import { useHandLayout, type RowConfig } from "./useHandLayout";
import "./Hand.scss";
import { useEffect, useState, type PointerEvent } from "react";
import { useGame } from "@/entities/game";
import { handAreaMarker } from "@/features/clear-board-selection";

type HandProps = {
  isSente: boolean;
};

/**
 * 片側の駒台。押した持ち駒を選び、手番でない側では選択を外すだけにする。
 *
 * 選択の state は種類までしか持たないので、同じ種類の何枚目を押したかはここで覚え、
 * 印を押した1枚にだけ付ける。
 */
function Hand({ isSente }: HandProps) {
  const { state, view, selectHand, clearSelection } = useGame();
  const [markedPiece, setMarkedPiece] = useState<{
    kind: string;
    nth: number;
  } | null>(null);

  const hands = view.player?.shogi.hands;
  const currentTurn = view.currentTurn;
  const selectedPosition = state.selectedPosition;

  const color = isSente ? Color.Black : Color.White;
  const handPieces = hands?.[color] || [];

  const handPiecesArray = Array.from(handPieces || []);
  const { arrangedPieces, layoutConfig } = useHandLayout(handPiecesArray);
  const isCurrentTurn = color === currentTurn;

  const isThisHandSelected = selectedPosition?.type === "hand" && selectedPosition.color === color;

  const isMarked = (pieceKind: string, nth: number) => {
    return (
      isThisHandSelected &&
      selectedPosition.kind === pieceKind &&
      markedPiece?.kind === pieceKind &&
      markedPiece.nth === nth
    );
  };

  const handlePieceClick = (pieceKind: string, nth: number) => {
    if (!isCurrentTurn) {
      clearSelection();
      return;
    }

    if (isMarked(pieceKind, nth)) {
      clearSelection();
      return;
    }

    setMarkedPiece({ kind: pieceKind, nth });
    selectHand(color, pieceKind as Kind);
  };

  const handleHandAreaPointerDown = (e: PointerEvent) => {
    if (!state.selectedPosition) return;

    const el = e.target as HTMLElement | null;
    if (!el) return;

    if (el.closest('[data-hand-piece="true"]')) return;

    clearSelection();
  };

  const renderPiecesInRow = (
    pieces: string[],
    rowConfig: RowConfig,
    seenOfKind: Map<string, number>,
  ) => {
    return pieces.map((pieceKind) => {
      const nth = seenOfKind.get(pieceKind) ?? 0;
      seenOfKind.set(pieceKind, nth + 1);

      const marked = isMarked(pieceKind, nth);

      return (
        <div
          key={`${pieceKind}-${nth}`}
          className={`hand-piece ${marked ? "hand-piece--selected" : ""}`}
          data-hand-piece="true"
          style={{
            width: `${rowConfig.pieceSize}em`,
            height: `${rowConfig.pieceSize * 1.1}em`,
          }}
        >
          <PieceImage
            kind={pieceKind}
            color={color}
            onClick={() => handlePieceClick(pieceKind, nth)}
          />
        </div>
      );
    });
  };

  useEffect(() => {
    if (!isThisHandSelected) {
      setMarkedPiece(null);
      return;
    }

    if (markedPiece && markedPiece.kind !== selectedPosition.kind) {
      setMarkedPiece(null);
    }
  }, [isThisHandSelected, selectedPosition, markedPiece]);

  const seenOfKind = new Map<string, number>();

  return (
    <div
      className={`hand-container ${isSente ? "player-hand" : "opponent-hand"}`}
      {...handAreaMarker}
      onPointerDown={handleHandAreaPointerDown}
    >
      <div className="hand-pieces">
        {(isSente ? ["row1", "row2", "row3", "row4"] : ["row4", "row3", "row2", "row1"]).map(
          (rowKey) => {
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
                {renderPiecesInRow(pieces, rowConfig, seenOfKind)}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

export default Hand;
