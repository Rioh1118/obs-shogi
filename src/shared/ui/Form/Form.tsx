import { useMemo, type ReactNode } from "react";
import "./Form.scss";

type FormTheme = "light" | "dark";

interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  theme?: FormTheme;
}

function Form({ children, handleSubmit, theme = "light", ...props }: FormProps) {
  const className = useMemo(
    () => ["form", `form--${theme}`].join(" "),
    [theme],
  );

  return (
    <form className={className} onSubmit={handleSubmit} {...props}>
      {children}
    </form>
  );
}

export default Form;
