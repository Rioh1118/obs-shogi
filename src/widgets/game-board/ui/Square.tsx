import type { ReactNode } from "react";
import "./Square.scss";
import { boardSquareMarker } from "@/features/clear-board-selection";

type SquareProps = {
  x: number;
  y: number;
  children?: ReactNode;
  isReachable?: boolean;
  isLastMove?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
};

function Square({
  x,
  y,
  children,
  isSelected = false,
  isReachable = false,
  isLastMove = false,
  onClick,
}: SquareProps) {
  return (
    <div
      className={`square ${isReachable ? "square__highlighted" : ""} ${isLastMove ? "square__last-move" : ""} ${isSelected ? "square--selected" : ""}`}
      {...boardSquareMarker}
      data-x={x}
      data-y={y}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export default Square;
