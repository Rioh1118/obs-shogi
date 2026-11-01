import type { ReactNode } from "react";
import "./SField.scss";

type Props = {
  label?: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
};

export default function SField({ label, description, hint, error, right, children }: Props) {
  return (
    <div className="sui-field">
      {(label || right) && (
        <div className="sui-field__head">
          {label && <label className="sui-field__label">{label}</label>}
          {right && <div className="sui-field__right">{right}</div>}
        </div>
      )}

      {description && <div className="sui-field__desc">{description}</div>}

      <div className="sui-field__control">{children}</div>

      {error ? (
        <div className="sui-field__error" role="alert">
          {error}
        </div>
      ) : (
        hint && <div className="sui-field__hint">{hint}</div>
      )}
    </div>
  );
}
