import type { FormEvent, FormHTMLAttributes, ReactNode } from "react";
import ModalFoot from "@/shared/ui/ModalFoot";
import "./Form.scss";

type FormProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode;
  /** 下の、押すものの行。欄を送っても動かない */
  foot: ReactNode;
  onSubmit: (e: FormEvent) => Promise<void>;
};

// 背景は暗い側だけ（ADR-0005 決定3）。明暗の軸は持たない。
// 持つと、暗いモーダルの中に明るい前提のフォームが載る組み合わせが型として通る
function Form({ children, foot, onSubmit, ...props }: FormProps) {
  return (
    <form className="form" onSubmit={onSubmit} {...props}>
      <div className="form__fields">{children}</div>
      <ModalFoot>{foot}</ModalFoot>
    </form>
  );
}

export default Form;
