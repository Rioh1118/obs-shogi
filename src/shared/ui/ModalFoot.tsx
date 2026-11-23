import type { ReactNode } from "react";
import "./ModalFoot.scss";

type Props = {
  /** 左に置くもの。添え書きか、取り消せない操作 */
  start?: ReactNode;
  /** 右に置く、閉じる・確定するもの */
  children?: ReactNode;
};

/** モーダルの下の、押すものの行。送るのは中身だけで、ここは動かない */
export default function ModalFoot({ start, children }: Props) {
  return (
    <footer className="modal-foot">
      {start && <div className="modal-foot__start">{start}</div>}
      {children && <div className="modal-foot__actions">{children}</div>}
    </footer>
  );
}
