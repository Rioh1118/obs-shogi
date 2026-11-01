import type { CSSProperties, ReactNode } from "react";
import "./SRadioGroup.scss";

type SRadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
};

type Layout = "list" | "grid";

type Props = {
  name: string;
  options: SRadioOption[];
  value: string;
  onChange: (value: string) => void;

  layout?: Layout;
  /** `layout` が `grid` のときの列の数 */
  columns?: number;
};

export default function SRadioGroup({
  name,
  options,
  value,
  onChange,
  layout = "list",
  columns = 2,
}: Props) {
  return (
    <div
      className="sui-radio"
      data-layout={layout}
      style={layout === "grid" ? ({ "--cols": String(columns) } as CSSProperties) : undefined}
      role="radiogroup"
    >
      {options.map((o) => {
        const checked = o.value === value;

        return (
          <label
            key={o.value}
            className="sui-radio__item"
            data-checked={checked ? "true" : "false"}
          >
            <input
              className="sui-radio__input"
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="sui-radio__card">
              <span className="sui-radio__top">
                <span className="sui-radio__dot" aria-hidden="true" />
                <span className="sui-radio__label">{o.label}</span>
              </span>
              {o.description && <span className="sui-radio__desc">{o.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
