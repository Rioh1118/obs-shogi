import type { ReactNode } from "react";
import "./SStats.scss";

type Stat = {
  label: string;
  value: ReactNode;
  /** 値の下に添える次の一手 */
  hint?: string;
};

/** 見せるだけの値の並び。名前の下に値。箱に入れない */
export default function SStats({ items }: { items: Stat[] }) {
  return (
    <dl className="sui-stats">
      {items.map(({ label, value, hint }) => (
        <div key={label} className="sui-stats__item">
          <dt className="sui-stats__label">{label}</dt>
          <dd className="sui-stats__value">{value}</dd>
          {hint && <dd className="sui-stats__hint">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
