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
 */
const stack: object[] = [];

/** 開いたときに積む。戻り値を `close` に渡す */
export function pushOverlay(token: object): void {
  stack.push(token);
}

export function popOverlay(token: object): void {
  const at = stack.indexOf(token);
  if (at >= 0) stack.splice(at, 1);
}

/** 最上位か。Escape と閉じ込めはこれが真のときだけ働く */
export function isTopOverlay(token: object): boolean {
  return stack[stack.length - 1] === token;
}
