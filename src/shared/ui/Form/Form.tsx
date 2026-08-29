import { useMemo, type ReactNode } from "react";
import "./Form.scss";

type FormTheme = "light" | "dark";

interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  theme?: FormTheme;
}

// 対話の面は暗い側を既定にしてある（ADR-0005）。`Modal` の既定と揃える。
// 揃えないと、暗いモーダルの中に明るい前提のフォームが載る組み合わせが既定になる
function Form({ children, handleSubmit, theme = "dark", ...props }: FormProps) {
  const className = useMemo(() => ["form", `form--${theme}`].join(" "), [theme]);

  return (
    <form className={className} onSubmit={handleSubmit} {...props}>
      {children}
    </form>
  );
}

export default Form;
