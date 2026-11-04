import type { ReactNode } from "react";
import "./GameBoard.scss";
import HandHeader from "./HandHeader";
import { useGame } from "@/entities/game";
import { playerNames } from "@/entities/kifu/lib/playerNames";
import { useBoardOrientation } from "@/features/board-orientation";

type Props = {
  topLeft: ReactNode;
  center: ReactNode;
  bottomRight: ReactNode;
};

/**
 * 盤と2つの駒台と対局者名を並べ、後手が手前のときは全体を回す。
 *
 * 盤の向きと対局者名は自分で取り、呼び手は区画の中身だけを渡す。
 * **対局者名は盤に載っている棋譜から取る**（`state.jkf`）。ツリーが開いたと言っている
 * 棋譜から取ると、盤に載せられなかったときに駒の並びと対局者名が別の棋譜になる。
 */
export default function GameBoard({ topLeft, center, bottomRight }: Props) {
  const { state } = useGame();
  const { isGotePov } = useBoardOrientation();
  // 欄名と欠けの判定は `playerNames` が持つ。ここで別に書くと、同じ棋譜について
  // ヘッダと盤で違う答えが出る
  const { sente: senteName, gote: goteName } = playerNames(state.jkf);

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
