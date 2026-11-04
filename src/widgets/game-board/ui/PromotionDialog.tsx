import { Color, type Kind } from "shogi.js";
import { promotedKind } from "@/entities/position/lib/positionDraft";
import PieceImage from "@/entities/position/ui/PieceImage";
import "./PromotionDialog.scss";

/** 移動先の升に重ねる成りの選択肢。成った駒と元の駒を並べ、押した方を返す */
function PromotionDialog({
  kind,
  color,
  onChoose,
}: {
  kind: Kind;
  color: Color;
  onChoose: (promote: boolean) => void;
}) {
  const promoted = promotedKind(kind);
  const isBlack = color === Color.Black;

  return (
    <div
      className={`promotion-choice ${isBlack ? "promotion-choice__black" : "promotion-choice__white"}`}
    >
      <div className="promotion-choice__piece">
        <div className="promotion-choice__piece--promote" onClick={() => onChoose(true)}>
          {promoted !== null && <PieceImage kind={promoted} color={color} />}
        </div>
        <div className="promotion-choice__piece--not-promote" onClick={() => onChoose(false)}>
          <PieceImage kind={kind} color={color} />
        </div>
      </div>
    </div>
  );
}

export default PromotionDialog;
