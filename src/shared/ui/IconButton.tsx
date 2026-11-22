import type { ReactNode, ButtonHTMLAttributes } from "react";
import "./IconButton.scss";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** 読み上げの名前。題だけでは、どの行のボタンかが分からないときに分ける */
  ariaLabel?: string;
};

/** 行や欄の中に置く、記号だけのボタン */
function IconButton({ children, className = "", ariaLabel, ...buttonProps }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={ariaLabel}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

export default IconButton;
