import type { ReactNode } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

function Button({
  variant = "primary",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`form__btn form__btn--${variant}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
