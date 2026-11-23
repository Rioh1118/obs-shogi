import type { ReactNode } from "react";
import "./ModalHead.scss";

type Props = {
  title: ReactNode;
  /** 題の下の1行 */
  description?: ReactNode;
  /** 右上に閉じるボタン（`Modal` の `showCloseButton`）があるなら、そのぶんを空ける */
  closable?: boolean;
  /** 題の右に置くもの */
  children?: ReactNode;
};

/** モーダルの題の行。送るのは中身だけで、ここは動かない */
export default function ModalHead({ title, description, closable = false, children }: Props) {
  return (
    <header className={closable ? "modal-head modal-head--closable" : "modal-head"}>
      <div className="modal-head__titles">
        <h2 className="modal-head__title">{title}</h2>
        {description && <p className="modal-head__desc">{description}</p>}
      </div>
      {children && <div className="modal-head__right">{children}</div>}
    </header>
  );
}
