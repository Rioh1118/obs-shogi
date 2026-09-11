import type { JKFState } from "@/entities/kifu/model/jkf";
import { indexToCoords } from "@/entities/position/lib/boardUtils";
import { pieceAt, squareKey, type Square } from "@/entities/position/lib/positionDraft";
import { BOARD_SIZE } from "@/entities/position/model/shogi";
import PieceFactory from "@/entities/position/ui/PieceFactory";
import { squareMark } from "../lib/boardMarks";
import type { Held } from "../model/types";

interface EditorBoardProps {
  state: JKFState;
  held: Held | null;
  hovered: Square | null;
  /** 規則に反する配置に関わる升（`squareKey` の集合） */
  illegalSquares: ReadonlySet<string>;
  onPressSquare: (sq: Square) => void;
  onFlipSquare: (sq: Square) => void;
  onHoverSquare: (sq: Square | null) => void;
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
function EditorBoard({
  state,
  held,
  hovered,
  illegalSquares,
  onPressSquare,
  onFlipSquare,
  onHoverSquare,
}: EditorBoardProps) {
  const heldFrom = held?.from === "square" ? held.sq : null;

  return (
    <div className="pos-editor__board" onMouseLeave={() => onHoverSquare(null)}>
      <div className="pos-editor__grid">
        {Array.from({ length: BOARD_SIZE.TOTAL_SQUARES }, (_, index) => {
          const sq = indexToCoords(index);
          const piece = pieceAt(state, sq);
          const mark = squareMark(state, held, hovered, sq);

          const classes = [
            "pos-editor__square",
            heldFrom?.x === sq.x && heldFrom?.y === sq.y && "pos-editor__square--from",
            mark.blocked && "pos-editor__square--blocked",
            mark.takes && "pos-editor__square--takes",
            mark.swaps && "pos-editor__square--swaps",
            illegalSquares.has(squareKey(sq)) && "pos-editor__square--illegal",
          ].filter(Boolean);

          return (
            <div
              key={index}
              className={classes.join(" ")}
              data-x={sq.x}
              data-y={sq.y}
              onClick={() => onPressSquare(sq)}
              onContextMenu={(e) => {
                // 盤の上では既定のメニューを出さない。器の中に OS のメニューが
                // 開くと、その裏で局面が変わったのかどうかが分からなくなる。
                // 駒が無い升では裏返すものが無いので、止めるだけ
                e.preventDefault();
                onFlipSquare(sq);
              }}
              onMouseEnter={() => onHoverSquare(sq)}
            >
              {piece && <PieceFactory jkfKind={piece.kind} color={piece.color} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EditorBoard;
