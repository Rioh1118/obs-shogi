import type { ReactNode } from "react";
import "./ControlButton.scss";

interface ControlButtonProps {
  children: ReactNode;
  handleClick: () => void;
  disabled?: boolean;
  title?: string; // ツールチップ用
}

function ControlButton({
  children,
  handleClick,
  disabled = false,
  title,
}: ControlButtonProps) {
  return (
    <button
      className="control-button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export default ControlButton;
