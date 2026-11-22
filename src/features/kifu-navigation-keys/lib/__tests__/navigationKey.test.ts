// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { kifuListMarker } from "../kifuListMarker";
import { navigationOf, type KifuNavigation } from "../navigationKey";

/**
 * どこにフォーカスがあるとき、どのキーを棋譜の移動として受けるか。
 *
 * 受けすぎると、付箋に書いている間やモーダルの中で矢印を押したときに盤が動く。
 * 受けなさすぎると、押しても何も起きないだけで、画面には何も出ない。
 * 表の出典は `docs/spec/screens/app-layout.md` の「キー操作」。
 */

/** 受けると決めたキー。表の列はこの6つ */
const KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "ArrowUp", "ArrowDown"] as const;

const SCREEN = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  Home: "start",
  End: "end",
  ArrowUp: null,
  ArrowDown: null,
} satisfies Record<(typeof KEYS)[number], KifuNavigation | null>;

const LIST = { ...SCREEN, ArrowUp: "previous", ArrowDown: "next" } as const;

const NOTHING = {
  ArrowLeft: null,
  ArrowRight: null,
  Home: null,
  End: null,
  ArrowUp: null,
  ArrowDown: null,
} as const;

/** メイン画面の、フォーカスが来る場所 */
const PLACES: Record<string, { html: string; expected: Record<string, KifuNavigation | null> }> = {
  ツリーの行: { html: '<div id="at" role="button" tabindex="0">棋譜.kif</div>', expected: SCREEN },
  ボタン: { html: '<button id="at">検討を開始</button>', expected: SCREEN },
  棋譜の一覧: { html: '<div data-list id="at" tabindex="0"><div>24</div></div>', expected: LIST },
  棋譜の行の中のボタン: {
    html: '<div data-list tabindex="0"><div><button id="at">コメント</button></div></div>',
    expected: LIST,
  },
  ツリーの改名の欄: { html: '<input id="at" type="text" />', expected: NOTHING },
  複数行の欄: { html: '<textarea id="at"></textarea>', expected: NOTHING },
  選ぶ欄: { html: '<select id="at"><option>a</option></select>', expected: NOTHING },
  コメントの付箋の本文: {
    html: '<div contenteditable="true"><p id="at">本文</p></div>',
    expected: NOTHING,
  },
  コメントの付箋のボタン: {
    html: '<div role="dialog" aria-modal="false"><button id="at">閉じる</button></div>',
    expected: NOTHING,
  },
  編集できない部分: {
    html: '<div contenteditable="false"><button id="at">閉じる</button></div>',
    expected: SCREEN,
  },
};

type KeyOptions = KeyboardEventInit & { preventedBy?: string };

/** `target` で `key` を押したときの `navigationOf` の答え */
function press(target: Element, key: string, { preventedBy, ...init }: KeyOptions = {}) {
  let answer: KifuNavigation | null | undefined;
  const listen = (event: KeyboardEvent) => {
    answer = navigationOf(event);
  };
  const prevent = (event: Event) => event.preventDefault();

  window.addEventListener("keydown", listen);
  if (preventedBy) document.querySelector(preventedBy)?.addEventListener("keydown", prevent);
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
  window.removeEventListener("keydown", listen);

  if (answer === undefined) throw new Error("window まで届いていない");
  return answer;
}

function place(html: string): HTMLElement {
  document.body.innerHTML = html;
  for (const list of document.querySelectorAll("[data-list]")) {
    for (const [name, value] of Object.entries(kifuListMarker)) list.setAttribute(name, value);
  }
  const at = document.getElementById("at");
  if (!at) throw new Error("#at が無い");
  return at;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("フォーカスの場所", () => {
  for (const [name, { html, expected }] of Object.entries(PLACES)) {
    test.each(KEYS)(`${name}: %s`, (key) => {
      expect(press(place(html), key)).toBe(expected[key]);
    });
  }

  // 候補手や定跡の表のように、押してもフォーカスを持てない場所も、キーは `body` に届く。
  // ↑ ↓ を受けると、表を流そうとして盤が動く
  test.each(KEYS)("どこにもフォーカスが無い: %s", (key) => {
    expect(press(document.body, key)).toBe(SCREEN[key]);
  });
});

describe("ほかのキー", () => {
  test.each(["a", "Enter", " ", "Escape", "Tab", "PageUp", "PageDown"])("%s は受けない", (key) => {
    expect(press(document.body, key)).toBeNull();
  });

  test.each(["altKey", "ctrlKey", "metaKey", "shiftKey"] as const)(
    "%s を押しながらの ← は受けない",
    (modifier) => {
      expect(press(document.body, "ArrowLeft", { [modifier]: true })).toBeNull();
    },
  );

  test("変換中の ← は受けない", () => {
    expect(press(document.body, "ArrowLeft", { isComposing: true })).toBeNull();
  });
});

describe("先に受けた部品があるとき", () => {
  test("ドックのタブ列が受けた ← は受けない", () => {
    const tab = place('<div role="tablist"><button id="at" role="tab">検討</button></div>');

    expect(press(tab, "ArrowLeft", { preventedBy: '[role="tablist"]' })).toBeNull();
  });

  test("タブ列が受けなかった Home は受ける", () => {
    const tab = place('<div role="tablist"><button id="at" role="tab">検討</button></div>');

    expect(press(tab, "Home")).toBe("start");
  });
});

describe("画面を覆うものが開いているとき", () => {
  test.each([
    ["モーダル", '<div role="dialog" aria-modal="true"></div>'],
    ["右クリックや分岐のメニュー", '<div role="menu"></div>'],
  ])("%s", (_, covering) => {
    document.body.innerHTML = `${covering}<button id="at">検討を開始</button>`;

    expect(press(document.getElementById("at")!, "ArrowRight")).toBeNull();
    expect(press(document.body, "End")).toBeNull();
  });

  // 付箋は開いたまま局面を動かして見比べるもの。覆うものには数えない
  test("付箋は、外にフォーカスがあれば受ける", () => {
    document.body.innerHTML =
      '<div role="dialog"><div contenteditable="true">本文</div></div><button id="at">検討</button>';

    expect(press(document.getElementById("at")!, "ArrowRight")).toBe("next");
  });
});
