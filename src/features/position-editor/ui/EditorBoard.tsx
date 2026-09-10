import type { JKFState } from "@/entities/kifu/model/jkf";
import { indexToCoords } from "@/entities/position/lib/boardUtils";
import { pieceAt } from "@/entities/position/lib/positionDraft";
import { BOARD_SIZE } from "@/entities/position/model/shogi";
import PieceFactory from "@/entities/position/ui/PieceFactory";

interface EditorBoardProps {
  state: JKFState;
}

/**
 * 組む面の盤
 *
 * **対局の盤（`widgets/game-board`）と別に持つ。** あちらは `useGame` から局面も
 * 合法手も取るので、種を載せただけの局面を描けない。幾何（画像の縦横比と枠の内寸）は
 * `entities/position/ui/shogiBoardGeometry.scss` で共有し、クラス名は共有しない。
 *
 * 升の並びは `indexToCoords` が決める（左上が9一）。ここで数え直すと、
 * 対局の盤と筋の向きが逆になっても、どちらも「盤に見える」ので気づけない。
 */
function EditorBoard({ state }: EditorBoardProps) {
  return (
    <div className="pos-editor__board">
      <div className="pos-editor__grid">
        {Array.from({ length: BOARD_SIZE.TOTAL_SQUARES }, (_, index) => {
          const { x, y } = indexToCoords(index);
          const piece = pieceAt(state, { x, y });

          return (
            <div key={index} className="pos-editor__square" data-x={x} data-y={y}>
              {piece && <PieceFactory jkfKind={piece.kind} color={piece.color} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EditorBoard;
