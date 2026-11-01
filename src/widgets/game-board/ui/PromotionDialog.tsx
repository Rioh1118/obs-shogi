import { Color } from "shogi.js";
import PieceImage from "@/entities/position/ui/PieceImage";
import "./PromotionDialog.scss";

function PromotionDialog({
  jkfKind,
  color,
  setPromote,
}: {
  jkfKind: string;
  color: Color;
  setPromote: (promote: boolean) => void;
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
      {/* <p className="promotion-choice__text">成りますか?</p> */}
      <div className="promotion-choice__piece">
        <div className="promotion-choice__piece--promote" onClick={() => setPromote(true)}>
          <PieceImage kind={promotionMap[jkfKind]} color={color} />
        </div>
        <div className="promotion-choice__piece--not-promote" onClick={() => setPromote(false)}>
          <PieceImage kind={jkfKind} color={color} />
        </div>
      </div>
    </div>
  );
}

export default PromotionDialog;
