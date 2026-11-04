import { Color } from "shogi.js";
import PieceImage from "@/entities/position/ui/PieceImage";
import "./PromotionDialog.scss";

/** 移動先の升に重ねる成りの選択肢。成った駒と元の駒を並べ、押した方を返す */
function PromotionDialog({
  kind,
  color,
  onChoose,
}: {
  kind: string;
  color: Color;
  onChoose: (promote: boolean) => void;
}) {
  const promotionMap: Record<string, string> = {
    FU: "TO",
    KY: "NY",
    KE: "NK",
    GI: "NG",
    KA: "UM",
    HI: "RY",
  };

  const isBlack = color === Color.Black;

  return (
    <div
      className={`promotion-choice ${isBlack ? "promotion-choice__black" : "promotion-choice__white"}`}
    >
      <div className="promotion-choice__piece">
        <div className="promotion-choice__piece--promote" onClick={() => onChoose(true)}>
          <PieceImage kind={promotionMap[kind]} color={color} />
        </div>
        <div className="promotion-choice__piece--not-promote" onClick={() => onChoose(false)}>
          <PieceImage kind={kind} color={color} />
        </div>
      </div>
    </div>
  );
}

export default PromotionDialog;
