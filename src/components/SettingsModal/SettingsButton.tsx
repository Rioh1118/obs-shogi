import type React from "react";
import "./SettingsButton.scss";

export type SettingsButtonVariant = "default" | "primary" | "ghost" | "danger";
export type SettingsButtonSize = "sm" | "md";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: SettingsButtonVariant;
  size?: SettingsButtonSize;
};

function SettingsButton({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...rest
}: Props) {
  const cls = ["sbtn", `sbtn--${variant}`, `sbtn--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={cls} {...rest} />;
}

export default SettingsButton;
