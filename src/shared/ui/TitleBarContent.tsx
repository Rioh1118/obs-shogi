import { use, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TitleBarSlotContext } from "./titleBarSlot";

/**
 * 中身をタイトルバーの中へ描く。
 *
 * 帯を1本にして、盤に高さを回すため。タイトルバーは境界の外に居るので、
 * 画面が落ちても、ウィンドウを動かす帯と操作のボタンは残る（`RuntimeShell`）。
 * タイトルバーが無い所では、その場に描く。
 */
function TitleBarContent({ children }: { children: ReactNode }) {
  const slot = use(TitleBarSlotContext);

  return slot ? createPortal(children, slot) : <>{children}</>;
}

export default TitleBarContent;
