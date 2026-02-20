import type { ReactNode } from "react";
import "./GameBoard.scss";

type Props = {
  topLeft: ReactNode;
  center: ReactNode;
  bottomRight: ReactNode;
};

export default function GameBoard({ topLeft, center, bottomRight }: Props) {
  return (
    <div className="game-board">
      <div className="game-board__cluster">
        <div className="game-board__hand game-board__hand--topLeft">
          {topLeft}
        </div>

        <div className="game-board__board">{center}</div>

        <div className="game-board__hand game-board__hand--bottomRight">
          {bottomRight}
        </div>
      </div>
    </div>
  );
}
