import type { ReactNode } from "react";
import "./GameBoard.scss";
import HandHeader from "./HandHeader";
import { useFileTree } from "@/entities/file-tree";
import { useBoardOrientation } from "@/features/board-orientation";

type Props = {
  topLeft: ReactNode;
  center: ReactNode;
  bottomRight: ReactNode;
};

/** 対局者名と同じく、盤の向きも自分でスライスから取る。呼び出し側は枠だけを渡す */
export default function GameBoard({ topLeft, center, bottomRight }: Props) {
  const { jkfData } = useFileTree();
  const { rotate } = useBoardOrientation();
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
