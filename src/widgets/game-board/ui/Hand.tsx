import { Color, type Kind } from "shogi.js";
import PieceImage from "@/entities/position/ui/PieceImage";
import { arrangeHand, type HandItem } from "../lib/arrangeHand";
import "./Hand.scss";
import { useMemo, useState, type PointerEvent } from "react";
import { useGame } from "@/entities/game";
import { handAreaMarker } from "@/features/clear-board-selection";

type HandProps = {
  isSente: boolean;
};

/**
 * 片側の駒台。押した持ち駒を選び、手番でない側では選択を外すだけにする。
 *
 * 選択の state は種類までしか持たないので、同じ種類の何枚目を押したかはここで覚え、
 * 目印を押した1枚にだけ付ける。覚えた1枚は選択が外れても消さない。目印を付けるかは
 * `isMarked` がいまの選択と突き合わせて決め、押して選ぶたびに覚え直す。
 */
function Hand({ isSente }: HandProps) {
  const { state, view, selectHand, clearSelection } = useGame();
  const [markedPiece, setMarkedPiece] = useState<{
    kind: Kind;
    nth: number;
  } | null>(null);

  const hands = view.player?.shogi.hands;
  const currentTurn = view.currentTurn;
  const selectedPosition = state.selectedPosition;

  const color = isSente ? Color.Black : Color.White;
  const handPieces = hands?.[color];

  const { rows, isGrouped } = useMemo(() => arrangeHand(handPieces ?? []), [handPieces]);
  // 後手は先手と上下を逆にする
  const shownRows = isSente ? rows : [...rows].reverse();
  const isCurrentTurn = color === currentTurn;

  const isThisHandSelected = selectedPosition?.type === "hand" && selectedPosition.color === color;

  const isMarked = (pieceKind: Kind, nth: number) => {
    return (
      isThisHandSelected &&
      selectedPosition.kind === pieceKind &&
      markedPiece?.kind === pieceKind &&
      markedPiece.nth === nth
    );
  };

  const handlePieceClick = (pieceKind: Kind, nth: number) => {
    if (!isCurrentTurn) {
      clearSelection();
      return;
    }

    if (isMarked(pieceKind, nth)) {
      clearSelection();
      return;
    }

    setMarkedPiece({ kind: pieceKind, nth });
    selectHand(color, pieceKind);
  };

  const handleHandAreaPointerDown = (e: PointerEvent) => {
    if (!state.selectedPosition) return;

    const el = e.target as HTMLElement | null;
    if (!el) return;

    if (el.closest('[data-hand-piece="true"]')) return;

    clearSelection();
  };

  const seenOfKind = new Map<Kind, number>();

  const renderItem = ({ kind, count }: HandItem) => {
    const nth = seenOfKind.get(kind) ?? 0;
    seenOfKind.set(kind, nth + 1);

    return (
      <div key={`${kind}-${nth}`} className="hand-stack">
        <div
          className={`hand-piece ${isMarked(kind, nth) ? "hand-piece--selected" : ""}`}
          data-hand-piece="true"
        >
          <PieceImage kind={kind} color={color} onClick={() => handlePieceClick(kind, nth)} />
        </div>
        {isGrouped && <span className="hand-stack__count">{count > 1 ? count : ""}</span>}
      </div>
    );
  };

  return (
    <div
      className={[
        "hand-container",
        isSente ? "player-hand" : "opponent-hand",
        isGrouped ? "hand-container--grouped" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...handAreaMarker}
      onPointerDown={handleHandAreaPointerDown}
    >
      {shownRows.map((items, i) => (
        <div key={i} className="hand-row">
          {items.map(renderItem)}
        </div>
      ))}
    </div>
  );
}

export default Hand;
