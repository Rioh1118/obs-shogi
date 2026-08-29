import { type ReactNode } from "react";
import "./Form.scss";

interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

// 面は暗い側だけ（ADR-0005 決定3）。明暗の軸は持たない。
// 持つと、暗いモーダルの中に明るい前提のフォームが載る組み合わせが型として通る
function Form({ children, handleSubmit, ...props }: FormProps) {
  return (
    <form className="form" onSubmit={handleSubmit} {...props}>
      {children}
    </form>
  );
}

export default Form;
