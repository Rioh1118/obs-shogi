import type { Color } from "shogi.js";
import { turnLabel } from "@/shared/lib/turn";
import Button from "@/shared/ui/Button/Button";

type EditorTurnProps = {
  color: Color;
  onToggle: () => void;
};

/**
 * 手番
 *
 * **盤の上に1行。枠も背景も持たせない。** 囲うと、盤・駒台と並ぶ4つ目の
 * 「駒を置く場所」に見える。このタブの置き場は3つで閉じているので、
 * 置き場に見えるものを増やさない。
 */
function EditorTurn({ color, onToggle }: EditorTurnProps) {
  return (
    <div className="pos-editor__turn">
      <span className="pos-editor__turn-label">手番</span>
      <span className="pos-editor__turn-value">{turnLabel(color)}</span>
      <Button size="sm" onClick={onToggle}>
        変更
      </Button>
    </div>
  );
}

export default EditorTurn;
