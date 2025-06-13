import type { ReactNode, ButtonHTMLAttributes, MouseEvent } from "react";
import "./ShogiButton.scss";

type ShogiButtonSize = "small" | "medium" | "large";
type ShogiButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ShogiButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  size?: ShogiButtonSize;
  variant?: ShogiButtonVariant;
  disabled?: boolean;
}

function ShogiButton({
  children,
  onClick,
  className = "",
  size = "medium",
  variant = "primary",
  disabled = false,
  ...buttonProps
}: ShogiButtonProps) {
  const buttonClassNames = [
    "shogi-button",
    `shogi-button--${size}`,
    `shogi-button--${variant}`,
    disabled && "shogi-button--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={buttonClassNames}
      onClick={onClick}
      disabled={disabled}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

export default ShogiButton;
