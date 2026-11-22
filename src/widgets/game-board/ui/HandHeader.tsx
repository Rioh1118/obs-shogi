import "./HandHeader.scss";
import { Color } from "shogi.js";
import { GOTE_GLYPH, SENTE_GLYPH, turnText } from "@/shared/lib/turn";

type HandSide = "sente" | "gote";
type HandPlacement = "top" | "bottom";

type Props = {
  side: HandSide;
  name?: string | null;
  boardRotated?: boolean;
  placement: HandPlacement;
  /** この側の手番か */
  isTurn: boolean;
};
const SIDE_UI: Record<
  HandSide,
  { label: string; turn: string; symbol: { top: string; bottom: string } }
> = {
  sente: { label: "先手", turn: turnText(Color.Black), symbol: { bottom: SENTE_GLYPH, top: "⛊" } },
  gote: { label: "後手", turn: turnText(Color.White), symbol: { bottom: GOTE_GLYPH, top: "⛉" } },
};

function truncateName(s: string) {
  const chars = Array.from(s);
  if (chars.length <= 15) return s;
  return chars.slice(0, 14).join("") + "…";
}

export default function HandHeader({ side, name, boardRotated = false, placement, isTurn }: Props) {
  const ui = SIDE_UI[side];
  // 欠けているかは `playerNames` が `null` で決めている。ここで trim し直さない
  const raw = name ?? "";
  const displayName = raw ? truncateName(raw) : "—";
  const symbol = ui.symbol[placement];

  return (
    <div
      className={[
        "hand-header",
        "hand-header--start",
        boardRotated ? "hand-header--counterRotate" : "",
        isTurn ? "hand-header--turn" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="hand-header__symbol" aria-label={ui.label}>
        {symbol}
      </span>

      <div className={"hand-header__name" + (raw ? "" : " hand-header__name--empty")} title={raw}>
        {displayName}
      </div>

      {isTurn && <span className="hand-header__turn">{ui.turn}</span>}
    </div>
  );
}
