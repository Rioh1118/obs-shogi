import type { CSSProperties, ReactNode } from "react";
import "./SRadioGroup.scss";

type SRadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
};

/** `list` は縦に1件ずつ、`grid` は見本つきの列、`segment` は短い語の区切りボタン */
type Layout = "list" | "grid" | "segment";

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
            <span className="sui-radio__dot" aria-hidden="true" />
            <span className="sui-radio__label">{o.label}</span>
            {o.description && <span className="sui-radio__desc">{o.description}</span>}
          </label>
        );
      })}
    </div>
  );
}
