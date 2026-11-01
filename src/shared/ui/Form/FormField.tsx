import type { ReactNode } from "react";
import "./Form.scss";

type FormFieldProps = {
  children: ReactNode;
  horizontal?: boolean;
};
function FormField({ children, horizontal = false }: FormFieldProps) {
  const className = horizontal ? "form__group form__group--horizontal" : "form__group";
  return <div className={className}>{children}</div>;
}

export default FormField;
