import type { InputHTMLAttributes, ReactNode } from "react";
import "./SCheckbox.scss";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  children: ReactNode;
  /** 名前の右に添える1語 */
  note?: string;
};

/** 入り切り。箱と名前のどちらを押しても切り替わる */
export default function SCheckbox({ children, note, ...input }: Props) {
  return (
    <label className="sui-check">
      <input type="checkbox" className="sui-check__box" {...input} />
      <span className="sui-check__label">{children}</span>
      {note && <span className="sui-check__note">{note}</span>}
    </label>
  );
}
