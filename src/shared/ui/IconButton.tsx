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

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> {
  children: ReactNode;
  handleClick?:
    | (() => void)
    | ((e: React.MouseEvent<HTMLButtonElement>) => void);
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
  const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled && handleClick) {
      if (handleClick.length > 0) {
        (handleClick as (e: React.MouseEvent<HTMLButtonElement>) => void)(e);
      } else {
        (handleClick as () => void)();
      }
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
