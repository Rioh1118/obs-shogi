import type { ReactNode } from "react";
import "./Square.scss";

interface SquareProps {
  x: number;
  y: number;
  index: number;
  children?: ReactNode;
  isHighlighted?: boolean;
  isLastMove?: boolean;
  onClick?: () => void;
}

function Square({
  x,
  y,
  index,
  children,
  isHighlighted = false,
  isLastMove = false,
  onClick,
}: SquareProps) {
  return (
    <div
      className={`square ${isHighlighted ? "highlighted" : ""} ${isLastMove ? "last-move" : ""}`}
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
