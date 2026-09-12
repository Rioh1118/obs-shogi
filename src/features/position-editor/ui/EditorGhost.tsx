import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Color, Kind } from "shogi.js";
import PieceFactory from "@/entities/position/ui/PieceFactory";

interface EditorGhostProps {
  kind: Kind;
  color: Color;
}

/**
 * 固定配置の原点を1度だけ測る
 *
 * **`position: fixed` はビューポート基準とは限らない。** `filter` / `backdrop-filter` /
 * `transform` を持つ祖先は固定配置の包含ブロックになる。`Modal` の覆いは
 * `backdrop-filter` を持ち、タイトルバーの下から始まるので、ポインタの座標を
 * そのまま書くと**縦にだけ**ずれて「少し下に付いてくる」形になる。
 *
 * 祖先を辿って何が包含ブロックかを当てるより、原点へ置いて測るほうが確実
 * （どの宣言が包含ブロックを作るかはブラウザと版で増える）。
 * `offsetParent` は固定配置では `null` なので使えない。
 */
function originOf(
  el: HTMLElement,
  cache: MutableRefObject<{ x: number; y: number } | null>,
): { x: number; y: number } {
  if (cache.current) return cache.current;

  el.style.left = "0px";
  el.style.top = "0px";
  const rect = el.getBoundingClientRect();
  // `translate(-50%, -50%)` が効いているので、箱の中心が原点に来ている
  cache.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return cache.current;
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
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;

      const { x, y } = originOf(el, originRef);
      el.style.left = `${event.clientX - x}px`;
      el.style.top = `${event.clientY - y}px`;
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
