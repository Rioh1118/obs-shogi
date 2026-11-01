import type { Kind } from "shogi.js";
import { HAND_KINDS, isHandKind } from "@/entities/position/lib/positionDraft";
import { toKan } from "@/entities/position/lib/toKan";
import "./HandRow.scss";

const countKinds = (kinds: Kind[]) => {
  const m = new Map<Kind, number>();
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

type Props = {
  label: string;
  kinds: Kind[];
};

function HandRow({ label, kinds }: Props) {
  const counts = countKinds(kinds);
  const ordered = [
    ...HAND_KINDS.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !isHandKind(k)),
  ];

  return (
    <div className="position-preview__hand">
      <div className="position-preview__hand-label">{label}</div>
      <div className="position-preview__hand-pieces">
        {ordered.length > 0 ? (
          ordered.map((kind) => {
            const n = counts.get(kind) ?? 0;
            const text = n >= 2 ? `${toKan(kind)}×${n}` : `${toKan(kind)}`;
            return (
              <span key={`${label}-${kind}`} className="position-preview__hand-chip">
                {text}
              </span>
            );
          })
        ) : (
          <span className="position-preview__hand-empty">なし</span>
        )}
      </div>
    </div>
  );
}

export default HandRow;
