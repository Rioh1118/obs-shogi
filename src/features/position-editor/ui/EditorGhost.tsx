import { useEffect, useRef, useState } from "react";
import type { Color, Kind } from "shogi.js";
import PieceFactory from "@/entities/position/ui/PieceFactory";

interface EditorGhostProps {
  kind: Kind;
  color: Color;
}

/**
 * 掴んでいる駒をカーソルに付ける
 *
 * **位置を state に持たない。** ポインタが動くたびに再描画すると、盤の81升と
 * 駒台が毎回作り直される。ref を通して `style` を直に書き、React の外で動かす。
 *
 * 最初の `mousemove` が来るまでは出さない。掴んだ時点のポインタ位置を
 * 知る口が無く、原点に一度描くと画面の隅で駒が光る。掴んでいることは
 * 元の升の残像が示しているので、1フレーム遅れても迷子にはならない。
 */
function EditorGhost({ kind, color }: EditorGhostProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      el.style.left = `${event.clientX}px`;
      el.style.top = `${event.clientY}px`;
      setPlaced(true);
    };

    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      className={`pos-editor__ghost${placed ? " pos-editor__ghost--placed" : ""}`}
      aria-hidden="true"
    >
      <PieceFactory jkfKind={kind} color={color} />
    </div>
  );
}

export default EditorGhost;
