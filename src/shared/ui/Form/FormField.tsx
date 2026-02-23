import type { ReactNode } from "react";
import "./Form.scss";

interface FormFieldProps {
  children: ReactNode;
  horizontal?: boolean;
}
function FormField({ children, horizontal = false }: FormFieldProps) {
  return (
    <div className={`form__group ${horizontal && "form__group--horizontal"}`}>
      {children}
    </div>
  );
}

export default FormField;
