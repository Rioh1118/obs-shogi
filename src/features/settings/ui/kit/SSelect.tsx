import type { Ref, SelectHTMLAttributes } from "react";
import "./SSelect.scss";

type SSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "className" | "size"> & {
  ref?: Ref<HTMLSelectElement>;
  options: SSelectOption[];
  /** `value` が空のときに選べない行で出す案内 */
  placeholder?: string;
  invalid?: boolean;
};

export default function SSelect({ options, placeholder, invalid, value, ref, ...rest }: Props) {
  return (
    <div className="sui-select" data-invalid={invalid ? "true" : "false"}>
      <select
        ref={ref}
        className="sui-select__control"
        value={value ?? ""}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {!!placeholder && (
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
}
