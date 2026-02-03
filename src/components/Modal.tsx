import type { ReactNode } from "react";
import "./Modal.scss";

type ModalTheme = "light" | "dark";

interface ModalProps {
  children: ReactNode;
  onToggle?: () => void;
  theme?: ModalTheme;
}

function Modal({ children, onToggle, theme = "light" }: ModalProps) {
  return (
    <div className={`modal modal--${theme}`}>
      <div className="modal__overlay" onClick={onToggle}>
        <div className="modal__card" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
