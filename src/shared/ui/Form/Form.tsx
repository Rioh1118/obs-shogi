import type { ReactNode } from "react";
import "./Form.scss";

interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

function Form({ children, handleSubmit, ...props }: FormProps) {
  return (
    <form className="form" onSubmit={handleSubmit} {...props}>
      {children}
    </form>
  );
}

export default Form;
