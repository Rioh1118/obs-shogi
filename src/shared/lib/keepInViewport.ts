/**
 * 画面の外へ出ない位置に丸める。
 *
 * ポインタの座標をそのまま `position: fixed` の `left` / `top` に渡すと、
 * 下端・右端で開いたものが画面外に落ちる。`fixed` なのでスクロールしても戻らず、
 * 閉じて開き直す以外に手が無くなる（ツリーの下端の数行がその状態だった）。
 */
export type ViewportBox = { left: number; top: number };

export function keepInViewport(
  at: { x: number; y: number },
  size: { width: number; height: number },
  margin = 8,
): ViewportBox {
  const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

  // 収まらないほど大きいときは `margin` を優先する（`hi < lo` になるため）
  return {
    left: clamp(at.x, margin, Math.max(margin, window.innerWidth - size.width - margin)),
    top: clamp(at.y, margin, Math.max(margin, window.innerHeight - size.height - margin)),
  };
}
