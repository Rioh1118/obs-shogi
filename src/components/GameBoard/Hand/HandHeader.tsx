import "./HandHeader.scss";

export type HandSide = "sente" | "gote";
export type HandAlign = "start" | "end";

export type HandHeaderMeta = {
  side: HandSide;
  name?: string | null;
  align?: HandAlign;
};

type Props = {
  side: HandSide;
  name?: string | null;
  align?: HandAlign;
};

const SIDE_UI: Record<HandSide, { label: string; symbol: string }> = {
  sente: { label: "先手", symbol: "☗" },
  gote: { label: "後手", symbol: "⛉" },
};

function clampTo15Chars(s: string) {
  const chars = Array.from(s);
  if (chars.length <= 15) return s;
  return chars.slice(0, 14).join("") + "…";
}

export default function HandHeader({ side, name, align = "start" }: Props) {
  const ui = SIDE_UI[side];
  const raw = name?.trim() ?? "";
  const displayName = raw ? clampTo15Chars(raw) : "—";

  return (
    <div className={`hand-header hand-header--${align}`}>
      <span className="hand-header__symbol" aria-label={ui.label}>
        {ui.symbol}
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
