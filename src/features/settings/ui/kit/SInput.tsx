import { forwardRef, type InputHTMLAttributes } from "react";
import "./SInput.scss";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  size?: "sm" | "md" | "lg";
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

const SInput = forwardRef<HTMLInputElement, Props>(function SInput(
  { className, invalid, size = "md", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx("sui-input", className)}
      data-size={size}
      data-invalid={invalid ? "true" : "false"}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export default SInput;
