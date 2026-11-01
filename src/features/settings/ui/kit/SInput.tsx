import type { InputHTMLAttributes, Ref } from "react";
import "./SInput.scss";

import { cx } from "@/features/settings/lib/cx";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  ref?: Ref<HTMLInputElement>;
  invalid?: boolean;
};

export default function SInput({ className, invalid, ref, ...rest }: Props) {
  return (
    <input
      ref={ref}
      className={cx("sui-input", className)}
      data-invalid={invalid ? "true" : "false"}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
