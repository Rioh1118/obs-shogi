import React from "react";
import "./SRadioGroup.scss";

export type SRadioOption = {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
};

type Layout = "list" | "grid";

type Props = {
  name: string;
  options: SRadioOption[];
  value: string;
  onChange: (value: string) => void;

  layout?: Layout;
  columns?: number; // gridのときだけ
  disabled?: boolean;
  invalid?: boolean;

  className?: string;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function SRadioGroup({
  name,
  options,
  value,
  onChange,
  layout = "list",
  columns = 2,
  disabled,
  invalid,
  className,
}: Props) {
  return (
    <div
      className={cx("sui-radio", className)}
      data-layout={layout}
      data-invalid={invalid ? "true" : "false"}
      style={
        layout === "grid"
          ? ({ ["--cols" as any]: String(columns) } as React.CSSProperties)
          : undefined
      }
      role="radiogroup"
      aria-invalid={invalid || undefined}
    >
      {options.map((o) => {
        const checked = o.value === value;
        const isDisabled = disabled || o.disabled;

        return (
          <label
            key={o.value}
            className="sui-radio__item"
            data-checked={checked ? "true" : "false"}
            data-disabled={isDisabled ? "true" : "false"}
          >
            <input
              className="sui-radio__input"
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={isDisabled}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="sui-radio__card">
              <span className="sui-radio__top">
                <span className="sui-radio__dot" aria-hidden="true" />
                <span className="sui-radio__label">{o.label}</span>
              </span>
              {o.description && (
                <span className="sui-radio__desc">{o.description}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
