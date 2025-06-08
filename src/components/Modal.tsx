import type { ReactNode } from "react";
import "./Modal.scss";

interface ModalProps {
  children: ReactNode;
  onToggle?: () => void;
}

function Modal({ children, onToggle }: ModalProps) {
  return (
    <div className="modal__overlay" onClick={onToggle}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default Modal;
