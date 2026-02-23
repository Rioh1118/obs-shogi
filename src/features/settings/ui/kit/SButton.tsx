import { type ButtonHTMLAttributes, type ReactNode } from "react";
import "./SButton.scss";

type Variant = "primary" | "subtle" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function SButton({
  children,
  className,
  variant = "subtle",
  size = "md",
  isLoading = false,
  disabled,
  type = "button",
  ...rest
}: Props) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      className={cx("sui-button", className)}
      data-variant={variant}
      data-size={size}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      <span className="sui-button__label">{children}</span>
      {isLoading && <span className="sui-button__spinner" aria-hidden="true" />}
    </button>
  );
}
