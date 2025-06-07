import type { ReactNode, ButtonHTMLAttributes } from "react";
import "./IconButton.scss";

type IconButtonSize = "small" | "medium" | "large" | "custom";
type IconButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "obs-primary"
  | "obs-ghost"
  | "sidebar-toggle"
  | "obs-danger";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  children: ReactNode;
  handleClick?: () => void;
  className?: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

function IconButton({
  children,
  handleClick,
  className = "",
  size = "medium",
  variant = "obs-primary",
  disabled = false,
  title,
  ariaLabel,
  ...buttonProps
}: IconButtonProps) {
  const handleButtonClick = () => {
    if (!disabled && handleClick) {
      handleClick();
    }
  };

  const buttonClasses = [
    "btn__icon",
    `btn__icon--${size}`,
    `btn__icon--${variant}`,
    disabled && "btn__icon--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={buttonClasses}
      onClick={handleButtonClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

export default IconButton;
