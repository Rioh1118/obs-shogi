import { Color } from "shogi.js";
import PieceFactory from "../PieceFactory";
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
        <div
          className="promotion-choice__piece--promote"
          onClick={() => setPromote(true)}
        >
          <PieceFactory
            jkfKind={promotionMap[jkfKind]}
            color={color}
            isPromoted={true}
          />
        </div>
        <div
          className="promotion-choice__piece--not-promote"
          onClick={() => setPromote(false)}
        >
          <PieceFactory jkfKind={jkfKind} color={color} isPromoted={false} />
        </div>
      </div>
    </div>
  );
}

export default PromotionDialog;
