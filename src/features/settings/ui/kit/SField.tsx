import { type ReactNode } from "react";
import "./SField.scss";

type Props = {
  label?: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;

  htmlFor?: string;
  right?: ReactNode;

  disabled?: boolean;
  invalid?: boolean;

  className?: string;
  children: ReactNode;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function SField({
  label,
  description,
  hint,
  error,
  htmlFor,
  right,
  disabled,
  invalid,
  className,
  children,
}: Props) {
  const showError = !!error;
  return (
    <div
      className={cx("sui-field", className)}
      data-disabled={disabled ? "true" : "false"}
      data-invalid={invalid || showError ? "true" : "false"}
    >
      {(label || right) && (
        <div className="sui-field__head">
          {label && (
            <label className="sui-field__label" htmlFor={htmlFor}>
              {label}
            </label>
          )}
          {right && <div className="sui-field__right">{right}</div>}
        </div>
      )}

      {description && <div className="sui-field__desc">{description}</div>}

      <div className="sui-field__control">{children}</div>

      {showError ? (
        <div className="sui-field__error" role="alert">
          {error}
        </div>
      ) : (
        hint && <div className="sui-field__hint">{hint}</div>
      )}
    </div>
  );
}
