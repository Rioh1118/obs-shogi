import type { ReactNode } from "react";
import "./ControlButton.scss";

interface ControlButtonProps {
  children: ReactNode;
  handleClick: () => void;
  disabled?: boolean;
  title?: string; // ツールチップ用
  /**
   * 押しっぱなしの状態を持つボタンか。**持たないボタンには渡さない。**
   *
   * 渡すと `aria-pressed` が付き、支援技術には「切り替えボタン」として読まれる。
   * 押すたびに別の場所へ行くボタン（棋譜のナビ）に付けると、状態を持たないものを
   * 状態があるものとして読ませることになる。
   *
   * **見た目は変えない。** この帯は面が半透明なので、状態を色で示すと文字と面の比が
   * 確定しないまま基準を割る（前の実装がそうだった）。目に見える印は、
   * 中身の側が持つこと —— 課題局面なら塗りつぶした栞。
   */
  pressed?: boolean;
}

function ControlButton({
  children,
  handleClick,
  disabled = false,
  title,
  pressed,
}: ControlButtonProps) {
  return (
    <button
      className="control-button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}

export default ControlButton;
