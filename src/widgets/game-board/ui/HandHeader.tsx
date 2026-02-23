import "./HandHeader.scss";

export type HandSide = "sente" | "gote";
export type HandAlign = "start" | "end";
export type HandPlacement = "top" | "bottom";

export type HandHeaderMeta = {
  side: HandSide;
  name?: string | null;
  align?: HandAlign;
};

type Props = HandHeaderMeta & {
  boardRotated?: boolean;
  placement: HandPlacement;
};
const SIDE_UI: Record<
  HandSide,
  { label: string; symbol: { top: string; bottom: string } }
> = {
  sente: { label: "先手", symbol: { bottom: "☗", top: "⛊" } },
  gote: { label: "後手", symbol: { bottom: "☖", top: "⛉" } },
};

function clampTo15Chars(s: string) {
  const chars = Array.from(s);
  if (chars.length <= 15) return s;
  return chars.slice(0, 14).join("") + "…";
}

export default function HandHeader({
  side,
  name,
  align = "start",
  boardRotated = false,
  placement,
}: Props) {
  const ui = SIDE_UI[side];
  const raw = name?.trim() ?? "";
  const displayName = raw ? clampTo15Chars(raw) : "—";
  const symbol = ui.symbol[placement];

  return (
    <div
      className={[
        "hand-header",
        `hand-header--${align}`,
        boardRotated ? "hand-header--counterRotate" : "",
      ].join(" ")}
    >
      <span className="hand-header__symbol" aria-label={ui.label}>
        {symbol}
      </span>

      <div
        className={
          "hand-header__name" + (raw ? "" : " hand-header__name--empty")
        }
        title={raw}
      >
        {displayName}
      </div>
    </div>
  );
}
