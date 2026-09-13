import type { CSSProperties } from "react";
import type { Color } from "shogi.js";
import type { JKFState } from "@/entities/kifu/model/jkf";
import {
  HAND_KINDS,
  handCount,
  type HandKind,
  type Square,
} from "@/entities/position/lib/positionDraft";
import PieceFactory from "@/entities/position/ui/PieceFactory";
import { turnLabel } from "@/shared/lib/turn";
import { standMark } from "../lib/boardMarks";
import type { Held } from "../model/types";

interface EditorStandProps {
  state: JKFState;
  color: Color;
  held: Held | null;
  hovered: Square | null;
  onPressStand: (color: Color, kind: HandKind | null) => void;
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
function EditorStand({ state, color, held, hovered, onPressStand }: EditorStandProps) {
  const heldHere = held?.from === "hand" && held.color === color ? held.kind : null;
  const mark = standMark(state, held, hovered, color);

  const classes = [
    "pos-editor__stand",
    mark.drop && "pos-editor__stand--drop",
    mark.blocked && "pos-editor__stand--blocked",
    mark.dest && "pos-editor__stand--dest",
  ].filter(Boolean);

  return (
    <div
      className={classes.join(" ")}
      data-color={color}
      // 掴んでいないときの駒台は「掴む場所」であって置き場ではない。受け口を
      // 張ると、余白を押しても何も起きない場所ができる
      onClick={held === null ? undefined : () => onPressStand(color, null)}
    >
      <div className="pos-editor__stand-head">{turnLabel(color)}の駒台</div>
      <div className="pos-editor__stand-rows">
        {HAND_KINDS.map((kind) => {
          const count = handCount(state, color, kind);
          if (count === 0) return null;

          return (
            <span
              key={kind}
              className={`pos-editor__stack${heldHere === kind ? " pos-editor__stack--held" : ""}`}
              data-kind={kind}
              style={{ "--stack-count": count } as CSSProperties}
              onClick={(e) => {
                // 駒台そのものの受け口へ二重に届かせない。掴んでいない間の意味
                // （この駒を掴む）と、掴んでいる間の意味（この駒台へ置く）は別
                e.stopPropagation();
                onPressStand(color, kind);
              }}
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
