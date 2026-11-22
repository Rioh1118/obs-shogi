import { KIFU_LIST_SELECTOR } from "./kifuListMarker";

/** 棋譜の中の移動。`GameControls` の4つのボタンと同じ */
export type KifuNavigation = "start" | "previous" | "next" | "end";

/** 画面のどこにフォーカスがあっても受けるキー */
const SCREEN_KEYS = new Map<string, KifuNavigation>([
  ["ArrowLeft", "previous"],
  ["ArrowRight", "next"],
  ["Home", "start"],
  ["End", "end"],
]);

/**
 * 棋譜の一覧にフォーカスがあるときだけ受けるキー。
 *
 * **フォーカスがどこにも無いときは受けない。** 押した場所がフォーカスを持てない（候補手や定跡の表の）とき、
 * キーは `body` に届くが、ブラウザはその表を流す。奪うと、表を読もうとして盤が動く
 */
const LIST_KEYS = new Map<string, KifuNavigation>([
  ["ArrowUp", "previous"],
  ["ArrowDown", "next"],
]);

/** 文字を打つ欄と選ぶ欄。ツリーの改名の欄がここに入る。矢印を自分で使う */
const EDITING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** コメントの付箋と、エンジンの状態の詳細。中のボタンで矢印を押したときに、書きかけの欄からフォーカスを奪わない */
const DIALOG = '[role="dialog"]';

/** 開いている間は、下の画面へキーを渡さないもの */
const COVERING = '[aria-modal="true"], [role="menu"]';

function isInKifuList(target: Element): boolean {
  return target.closest(KIFU_LIST_SELECTOR) !== null;
}

/**
 * このキーで棋譜の中をどう動くか。動かないなら `null`。
 *
 * 受ける条件の表は `docs/spec/screens/app-layout.md` の「キー操作」。
 * 矢印を自分で使う部品は、React の `onKeyDown` か `document` で受けて `preventDefault()` する（`Dock` のタブ列）。
 * ここは `window` で聞くので、それを見て降りる。`window` で後から聞く部品の `preventDefault()` は間に合わない。
 */
export function navigationOf(event: KeyboardEvent): KifuNavigation | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;

  const { target } = event;
  if (!(target instanceof Element)) return null;

  const navigation =
    SCREEN_KEYS.get(event.key) ?? (isInKifuList(target) && LIST_KEYS.get(event.key));
  if (!navigation) return null;

  if (target.closest(EDITING) || target.closest(DIALOG)) return null;
  if (document.querySelector(COVERING)) return null;

  return navigation;
}
