import type { ReactNode } from "react";
import "./GameBoard.scss";

function BoardBox({ children }: { children: ReactNode }) {
  return <div className="game-board">{children}</div>;
}

export default BoardBox;
