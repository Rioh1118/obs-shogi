import { useCallback, useEffect, useRef } from "react";

/**
 * 重なって開いているもの（モーダル、付箋、メニュー）の順序。
 *
 * Escape とフォーカスの閉じ込めは**最上位の1つだけ**が扱う。
 * 1つずつ独立に `window` へ `keydown` を張ると、1回の Escape で重なっている全部が閉じる。
 * `preventDefault()` は伝播を止めないので、キャプチャ段で処理しても相手に届く。
 * フォーカスの閉じ込めを独立させると、2枚が互いに奪い返し、`focus()` が同期でイベントを撒き続ける。
 *
 * 鍵は要素でなくトークン。DOM を持たない重なり（`ContextMenu`、付箋）も同じ順序に載せられる。
 * 公開するのは `useOverlayLayer` だけで、積み降ろしを外から書かせない。
 */
const stack: object[] = [];

function pushOverlay(token: object): void {
  stack.push(token);
}

function popOverlay(token: object): void {
  const at = stack.indexOf(token);
  if (at >= 0) stack.splice(at, 1);
}

/**
 * 重なりに1枚として参加し、自分が最上位かを答える関数を返す。
 *
 * Escape と閉じ込めは、この関数が真のときだけ働かせる。
 *
 * **積み降ろしは `open` の切り替わりだけで起こす。** ハンドラを依存に入れると、親の再描画のたびに
 * pop と push が走って自分が最上位へ登り直し、上のモーダルから Escape と閉じ込めを奪う。
 * `onClose={() => ...}` は普通の書き方なので、トークンを ref に持ち、依存を `[open]` に固定している。
 */
export function useOverlayLayer(open: boolean): () => boolean {
  const tokenRef = useRef<object>({});

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    pushOverlay(token);
    return () => popOverlay(token);
  }, [open]);

  return useCallback(() => stack[stack.length - 1] === tokenRef.current, []);
}
