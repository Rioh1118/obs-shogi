import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.scss";

/** 面の色と文字色を決める。それ以外の軸とは独立している。 */
export type ButtonTone = "primary" | "neutral" | "quiet" | "danger";
/** 高さ・左右の余白・文字サイズをまとめて決める。 */
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonRadius = "sharp" | "soft" | "pill";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  radius?: ButtonRadius;
  /** ホバーの影と押下の沈み込み。並べて何度も押す場所では切る */
  motion?: boolean;
  block?: boolean;
  /** 処理中。押せなくしたうえで、待っていることを支援技術にも伝える */
  isLoading?: boolean;
  children: ReactNode;
}

/**
 * アプリ共通のボタン。
 *
 * **明るい面の上には置かない。** 通知や対話の面は暗い側を既定にしてある（ADR-0004）ので、
 * 明暗の2系統を持たない。明るい面が要る画面が出たら、そのときに軸を足す。
 */
export default function Button({
  tone = "neutral",
  size = "md",
  radius = "soft",
  motion = true,
  block = false,
  isLoading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "uiBtn",
    `uiBtn--${tone}`,
    `uiBtn--${size}`,
    `uiBtn--r-${radius}`,
    motion ? "uiBtn--motion" : null,
    block ? "uiBtn--block" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      <span className="uiBtn__label">{children}</span>
      {isLoading && <span className="uiBtn__spinner" aria-hidden="true" />}
    </button>
  );
}
