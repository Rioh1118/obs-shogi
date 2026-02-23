import "./HandRow.scss";

const HAND_ORDER = ["FU", "KY", "KE", "GI", "KI", "KA", "HI"];

const countKinds = (kinds: string[]) => {
  const m = new Map<string, number>();
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

type Props = {
  label: string;
  kinds: string[];
  toKan: (k: string) => string;
};

function HandRow({ label, kinds, toKan }: Props) {
  const counts = countKinds(kinds);
  const ordered = [
    ...HAND_ORDER.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !HAND_ORDER.includes(k)),
  ];

  return (
    <div className="position-navigation-modal__hand">
      <div className="position-navigation-modal__hand-label">{label}</div>
      <div className="position-navigation-modal__hand-pieces">
        {ordered.length > 0 ? (
          ordered.map((kind) => {
            const n = counts.get(kind) ?? 0;
            const text = n >= 2 ? `${toKan(kind)}×${n}` : `${toKan(kind)}`;
            return (
              <span
                key={`${label}-${kind}`}
                className="position-navigation-modal__hand-chip"
              >
                {text}
              </span>
            );
          })
        ) : (
          <span className="position-navigation-modal__hand-empty">なし</span>
        )}
      </div>
    </div>
  );
}

export default HandRow;
