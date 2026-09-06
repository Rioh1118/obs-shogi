import type { ReactNode } from "react";
import "./GameBoard.scss";
import HandHeader from "./HandHeader";
import { useGame } from "@/entities/game";
import { useBoardOrientation } from "@/features/board-orientation";

type Props = {
  topLeft: ReactNode;
  center: ReactNode;
  bottomRight: ReactNode;
};

/**
 * 対局者名と同じく、盤の向きも自分でスライスから取る。呼び出し側は枠だけを渡す。
 *
 * **対局者名は盤に載っている棋譜から取る**（`useResetOrientationOnKifuChange` が
 * 向きの合図に `loadedAbsPath` を選んだのと同じ理由）。ツリーが開いたと言っている
 * 棋譜から取ると、盤に載せられなかったときに駒の並びと対局者名が別の棋譜になる。
 */
export default function GameBoard({ topLeft, center, bottomRight }: Props) {
  const { state } = useGame();
  const { isGotePov } = useBoardOrientation();
  const header = state.jkf?.header ?? {};
  const senteName = header["先手"]?.trim();
  const goteName = header["後手"]?.trim();

  const gotePlacement = isGotePov ? "bottom" : "top";
  const sentePlacement = isGotePov ? "top" : "bottom";

  return (
    <div className={`game-board ${isGotePov ? "game-board--rotated" : ""}`}>
      <div className="game-board__cluster">
        <div className="game-board__hand game-board__hand--topLeft">
          <div className="game-board__handArea">{topLeft}</div>
          <div className="game-board__handHeader">
            <HandHeader
              side="gote"
              name={goteName}
              align="start"
              boardRotated={isGotePov}
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
              boardRotated={isGotePov}
              placement={sentePlacement}
            />
          </div>
          <div className="game-board__handArea">{bottomRight}</div>
        </div>
      </div>
    </div>
  );
}
