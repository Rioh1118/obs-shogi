import { useCallback, useEffect, useRef } from "react";

/**
 * 重なって開いているもの（モーダル・付箋・メニュー）の順序。
 *
 * Escape とフォーカスの閉じ込めは**最上位の1つだけ**が扱う。
 * 1つずつ独立に `window` へ `keydown` を張ると、1回の Escape で
 * 重なっている全部が閉じる。`preventDefault()` は伝播を止めないので、
 * キャプチャ段で先に処理しても、バブル段の相手には同じイベントが届く。
 *
 * フォーカスの閉じ込めも同じで、独立させると2枚が互いに奪い返し合い、
 * `focus()` が同期でイベントを撒き続けてマイクロタスクが空にならない。
 *
 * **鍵は要素でなくトークン。** DOM を持たない重なり（`ContextMenu` は
 * `position: fixed` の div、付箋は別の座標系）も同じ順序に載せられる。
 *
 * 出しているのは `useOverlayLayer` だけ。積み降ろしを外から書けるようにすると、
 * 依存配列の選び方1つで順序が壊れる（下の TSDoc を参照）
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
 * 重なりに1枚として参加する。返るのは「自分が最上位か」を答える関数で、
 * Escape と閉じ込めはこれが真のときだけ働かせる。
 *
 * **積み降ろしは `open` の切り替わりだけで起こす。** ハンドラを依存に入れると、
 * 親が再描画するたびに pop → push が走って自分が最上位へ登り直し、
 * 上に載っているモーダルから Escape とフォーカスの閉じ込めを奪う。
 * `onClose={() => ...}` のようにその場で作る関数を渡すのはごく普通の書き方なので、
 * トークンを ref に持ち依存を `[open]` に固定して、**呼び出し側から
 * 依存の選択を奪っている**
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
