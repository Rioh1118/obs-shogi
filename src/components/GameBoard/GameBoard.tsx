import type { ReactNode } from "react";
import "./GameBoard.scss";
import HandHeader from "./Hand/HandHeader";
import { useFileTree } from "@/contexts/FileTreeContext";

type Props = {
  topLeft: ReactNode;
  center: ReactNode;
  bottomRight: ReactNode;
  rotate?: boolean;
};

export default function GameBoard({
  topLeft,
  center,
  bottomRight,
  rotate = false,
}: Props) {
  const { jkfData } = useFileTree();
  const header = jkfData?.header ?? {};
  const senteName = header["先手"]?.trim();
  const goteName = header["後手"]?.trim();

  const gotePlacement = rotate ? "bottom" : "top";
  const sentePlacement = rotate ? "top" : "bottom";

  return (
    <div className={`game-board ${rotate ? "game-board--rotated" : ""}`}>
      <div className="game-board__cluster">
        <div className="game-board__hand game-board__hand--topLeft">
          <div className="game-board__handArea">{topLeft}</div>
          <div className="game-board__handHeader">
            <HandHeader
              side="gote"
              name={goteName}
              align="start"
              boardRotated={rotate}
              placement={gotePlacement}
            />
          </div>
        </div>

        <div className="game-board__board">{center}</div>

        <div className="game-board__hand game-board__hand--bottomRight">
          <div className="game-board__handHeader">
            <HandHeader
              side="sente"
              name={senteName}
              align="start"
              boardRotated={rotate}
              placement={sentePlacement}
            />
          </div>
          <div className="game-board__handArea">{bottomRight}</div>
        </div>
      </div>
    </div>
  );
}
