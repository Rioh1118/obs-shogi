import { forwardRef, type SelectHTMLAttributes } from "react";
import "./SSelect.scss";

export type SSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  options: SSelectOption[];
  placeholder?: string; // value="" のとき表示
  invalid?: boolean;
  size?: "sm" | "md" | "lg";
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

const SSelect = forwardRef<HTMLSelectElement, Props>(function SSelect(
  { className, options, placeholder, invalid, size = "md", value, ...rest },
  ref,
) {
  const v = value ?? "";
  const hasPlaceholder =
    typeof placeholder === "string" && placeholder.length > 0;

  return (
    <div
      className={cx("sui-select", className)}
      data-size={size}
      data-invalid={invalid ? "true" : "false"}
    >
      <select
        ref={ref}
        className="sui-select__control"
        value={v as any}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {hasPlaceholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="sui-select__chev" aria-hidden="true">
        ▾
      </span>
    </div>
  );
});

export default SSelect;
