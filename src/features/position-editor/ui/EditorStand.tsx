import type { CSSProperties } from "react";
import type { Color } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { HAND_KINDS, handCount } from "@/entities/position/lib/positionDraft";
import PieceFactory from "@/entities/position/ui/PieceFactory";
import { turnLabel } from "@/shared/lib/turn";

interface EditorStandProps {
  state: JKFState;
  color: Color;
}

/**
 * 駒台
 *
 * **枚数を数字で出さない。** 同じ種類は重ねて置く（実物の駒台と同じ）。
 * 数字を添えると、盤の駒と駒台の駒で「1枚がどう見えるか」が変わり、
 * 掴んで置くという1つの操作の中で表現が2通りになる。
 *
 * **中身の量で伸び縮みしない。** 高さは局面によらず一定にする。動くと、
 * 駒を1枚送っただけで狙っていた升の位置がずれる。
 *
 * 並びは `HAND_KINDS` の順。`serializeDraft` が同じ順で駒台を直列化するので、
 * 画面の並びと「組みかけか」の比較が同じ出典から出る。
 */
function EditorStand({ state, color }: EditorStandProps) {
  return (
    <div className="pos-editor__stand" data-color={color}>
      <div className="pos-editor__stand-head">{turnLabel(color)}の駒台</div>
      <div className="pos-editor__stand-rows">
        {HAND_KINDS.map((kind) => {
          const count = handCount(state, color, kind);
          if (count === 0) return null;

          return (
            <span
              key={kind}
              className="pos-editor__stack"
              style={{ "--stack-count": count } as CSSProperties}
            >
              {Array.from({ length: count }, (_, i) => (
                <span
                  key={i}
                  className="pos-editor__stack-piece"
                  style={{ "--stack-index": i } as CSSProperties}
                >
                  <PieceFactory jkfKind={kind} color={color} />
                </span>
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default EditorStand;
