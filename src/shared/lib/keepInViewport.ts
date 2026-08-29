export type ViewportBox = { left: number; top: number };

/**
 * 画面の外へ出ない位置に丸める。
 *
 * ポインタの座標をそのまま `position: fixed` の `left` / `top` に渡すと、
 * 下端・右端で開いたものが画面外に落ちる。`fixed` なのでスクロールしても戻らず、
 * 閉じて開き直す以外に手が無い。
 *
 * `margin` の既定 8 は、画面の縁に貼り付かせないための最小の余白。
 * これ以上詰めると、影が切れて枠が背景と一体に見える
 */
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
