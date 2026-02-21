import type { ReactNode } from "react";
import "./Square.scss";

interface SquareProps {
  x: number;
  y: number;
  index: number;
  children?: ReactNode;
  isHighlighted?: boolean;
  isLastMove?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

function Square({
  x,
  y,
  index,
  children,
  isSelected = false,
  isHighlighted = false,
  isLastMove = false,
  onClick,
}: SquareProps) {
  return (
    <div
      className={`square ${isHighlighted ? "square__highlighted" : ""} ${isLastMove ? "square__last-move" : ""} ${isSelected ? "square--selected" : ""}`}
      data-board-square="true"
      data-x={x}
      data-y={y}
      data-index={index}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export default Square;
