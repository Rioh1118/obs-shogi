import type { ReactNode } from "react";
import "./ControlButton.scss";

type ControlButtonProps = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string; // ツールチップ用
};

function ControlButton({ children, onClick, disabled = false, title }: ControlButtonProps) {
  return (
    <button
      type="button"
      className="control-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export default ControlButton;
