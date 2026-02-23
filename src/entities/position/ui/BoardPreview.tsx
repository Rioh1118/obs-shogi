import { useMemo } from "react";
import { Piece, Color } from "shogi.js";
import { indexToCoords } from "@/entities/position/lib/boardUtils";
import { BOARD_SIZE } from "@/entities/position/model/shogi";
import PieceFactory from "../../../widgets/game-board/ui/PieceFactory";
import "./BoardPreview.scss";
import type { ShogiMove } from "@/entities/game";

export interface BoardPreviewProps {
  // 盤面データ
  pieces?: Piece[][];

  // 手駒データ
  hands?: { [Color.Black]: string[]; [Color.White]: string[] };

  // サイズ設定
  size?: "small" | "medium" | "large" | number;

  // 表示オプション
  showCoordinates?: boolean;
  showLastMove?: boolean;
  showLegalMoves?: boolean;
  showHands?: boolean;

  // インタラクション
  interactive?: boolean;
  onSquareClick?: (x: number, y: number) => void;

  // ハイライト
  lastMove?: ShogiMove | null;
  selectedPosition?: { x: number; y: number } | null;
  legalMoves?: Array<{ to: { x: number; y: number } }>;
}

// サイズのマッピング
const SIZE_MAP = {
  small: 180,
  medium: 300,
  large: 440,
} as const;

function BoardPreview({
  pieces,
  hands,
  size = "medium",
  showCoordinates = false,
  showLastMove = true,
  showLegalMoves = false,
  showHands = true,
  interactive = false,
  onSquareClick,
  lastMove,
  selectedPosition,
  legalMoves = [],
}: BoardPreviewProps) {
  // サイズを数値に変換
  const boardSize = useMemo(() => {
    if (typeof size === "number") return size;
    return SIZE_MAP[size];
  }, [size]);

  // CSS変数でサイズを設定
  const boardStyle = useMemo(
    () =>
      ({
        "--board-size": `${boardSize}px`,
        "--square-size": `${boardSize / 9}px`,
        "--piece-size": `${(boardSize / 9) * 0.8}px`,
      }) as React.CSSProperties,
    [boardSize],
  );

  // クリックハンドラー
  const handleSquareClick = (index: number) => {
    if (!interactive || !onSquareClick) return;

    const { x, y } = indexToCoords(index);
    onSquareClick(x, y);
  };

  // 最後の手のハイライト判定
  const isLastMoveSquare = (x: number, y: number): boolean => {
    if (!showLastMove || !lastMove) return false;
    return (
      (lastMove.from && lastMove.from.x === x && lastMove.from.y === y) ||
      (lastMove.to.x === x && lastMove.to.y === y)
    );
  };

  // 選択マスの判定
  const isSelectedSquare = (x: number, y: number): boolean => {
    return selectedPosition?.x === x && selectedPosition?.y === y;
  };

  // 合法手マスの判定
  const isLegalMoveSquare = (x: number, y: number): boolean => {
    if (!showLegalMoves) return false;
    return legalMoves.some((move) => move.to.x === x && move.to.y === y);
  };

  // 手駒の表示コンポーネント
  const renderHands = () => {
    if (!showHands || !hands) return null;

    const blackHand = hands[Color.Black] || [];
    const whiteHand = hands[Color.White] || [];

    return (
      <div className="board-preview__hands">
        <div className="board-preview__hand board-preview__hand--white">
          <div className="board-preview__hand-label">☗後手</div>
          <div className="board-preview__hand-pieces">
            {whiteHand.map((kind, index) => (
              <div
                key={`white-${kind}-${index}`}
                className="board-preview__hand-piece"
              >
                <PieceFactory jkfKind={kind} color={Color.White} />
              </div>
            ))}
            {whiteHand.length === 0 && (
              <div className="board-preview__hand-empty">なし</div>
            )}
          </div>
        </div>

        <div className="board-preview__hand board-preview__hand--black">
          <div className="board-preview__hand-label">☖先手</div>
          <div className="board-preview__hand-pieces">
            {blackHand.map((kind, index) => (
              <div
                key={`black-${kind}-${index}`}
                className="board-preview__hand-piece"
              >
                <PieceFactory jkfKind={kind} color={Color.Black} />
              </div>
            ))}
            {blackHand.length === 0 && (
              <div className="board-preview__hand-empty">なし</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="board-preview"
      style={boardStyle}
      data-size={typeof size === "string" ? size : "custom"}
    >
      {renderHands()}
      <div className="board-preview__container">
        <div className="board-preview__grid">
          {Array.from({ length: BOARD_SIZE.TOTAL_SQUARES }).map((_, index) => {
            const { x, y } = indexToCoords(index);
            const piece = pieces?.[x - 1]?.[y - 1];

            const squareClasses = [
              "board-preview__square",
              isLastMoveSquare(x, y) && "board-preview__square--last-move",
              isSelectedSquare(x, y) && "board-preview__square--selected",
              isLegalMoveSquare(x, y) && "board-preview__square--legal",
              interactive && "board-preview__square--interactive",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={index}
                className={squareClasses}
                onClick={() => handleSquareClick(index)}
              >
                {piece && (
                  <div className="board-preview__piece">
                    <PieceFactory
                      jkfKind={piece.kind}
                      color={piece.color}
                      isPromoted={Piece.isPromoted(piece.kind)}
                    />
                  </div>
                )}

                {showCoordinates && x === 9 && (
                  <div className="board-preview__coordinate board-preview__coordinate--vertical">
                    {y}
                  </div>
                )}

                {showCoordinates && y === 1 && (
                  <div className="board-preview__coordinate board-preview__coordinate--horizontal">
                    {x}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default BoardPreview;
