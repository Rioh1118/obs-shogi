import type { IndexWarnPayload } from "../api/events";

/**
 * 画面に出す警告を `slots` 件まで選ぶ。
 *
 * 場所を名指しできる警告、場所の分からない警告、棋譜の警告の順に、それぞれ新しいものから取る。
 *
 * - 新しい順にするのは、reducer が末尾に積むので、先頭から読むと古い警告が枠に居座るため
 * - 場所を先に取るのは、再走査の棋譜の警告が、次にすることを含む場所の警告を押し出すため
 * - 名指しを先に取るのは、Rust が1回の走査で出す最大3本のうち1本は `path` が空で、
 *   動く手掛かりが無いため
 *
 * 警告は履歴で、走査が成功しても消えず、根が変わるか「警告をクリア」を押すまで残る。
 * いまの具合は `indexHealth` が言う。
 *
 * 同じ走査の3本の重さの順は復元しない。届いた順しか手元に無く、走査の切れ目が payload に無い。
 */
export function pickWarns(warns: IndexWarnPayload[], slots: number): IndexWarnPayload[] {
  const newestFirst = warns.slice().reverse();
  const places = newestFirst.filter((w) => w.kind === "place");
  const files = newestFirst.filter((w) => w.kind !== "place");
  // `filter` は順を保つので、名指しできるもの同士の新しい順は崩れない
  const named = places.filter((w) => w.path !== "");
  const unnamed = places.filter((w) => w.path === "");
  return [...named, ...unnamed, ...files].slice(0, slots);
}
