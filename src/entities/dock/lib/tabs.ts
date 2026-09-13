import type { DockViewType } from "@/shared/lib/router/useURLParams";
import { DOCK_VIEWS, dockViewMeta } from "../model/views";

/**
 * 保存されている綴りが名簿に在るか。
 *
 * **設定ファイルは利用者が手で書けるし、前の版が書いた綴りも残る。**
 * 名簿に無い綴りをそのまま画面へ渡すと、割り当ての無いタブが出て中身が空になる。
 */
function isDockViewType(value: unknown): value is DockViewType {
  return typeof value === "string" && DOCK_VIEWS.some((v) => v.key === value);
}

/**
 * タブ一覧を組む。**返る一覧は必ず1枚以上ある。**
 *
 * `saved` は設定に残っている並び（`AppConfig.dock_tabs`）。まだ選んでいなければ
 * `null` で、そのときは名簿の `defaultVisible` が決める。
 *
 * **外せないビューは、`saved` が落としていても入れ直す。** 空のドックという状態を
 * 作らないため（ADR-0010 決定1）。
 *
 * **`saved` に在る綴りが名簿に無ければ捨てる。** 前の版が書いた綴りや手で書いた
 * 綴りが混ざるので、ここで濾さないと中身の無いタブが出る。
 */
export function resolveDockTabs(saved: readonly string[] | null | undefined): DockViewType[] {
  const chosen =
    saved == null
      ? DOCK_VIEWS.filter((v) => v.defaultVisible).map((v) => v.key)
      : saved.filter(isDockViewType);

  const tabs: DockViewType[] = [];
  for (const key of chosen) {
    if (!tabs.includes(key)) tabs.push(key);
  }

  for (const view of DOCK_VIEWS) {
    if (!view.removable && !tabs.includes(view.key)) tabs.push(view.key);
  }

  return tabs;
}

/** どのビューを出すかを決める材料 */
type DockViewSelection = {
  /** URL の `dock=`。無ければ `undefined` */
  fromUrl?: string | null;
  /** 起動時に開くタブ。**`null` は「前回のもの」** */
  startupTab?: string | null;
  /** 前回開いていたタブ */
  lastTab?: string | null;
};

/**
 * いま出すビューを決める。**`tabs` の中からしか選ばない。**
 *
 * 順に、URL の綴り → 起動時に開くと決めてあるタブ → 前回開いていたタブ →
 * 一覧の先頭。どの段も、一覧に無い綴りは飛ばす——一覧から外したタブが
 * URL や設定に残っているだけで、タブ列に無いものが本体に出てしまう。
 *
 * `tabs` は [`resolveDockTabs`] が返したものを渡すこと（空でないことが前提）。
 */
export function resolveDockView(
  tabs: readonly DockViewType[],
  selection: DockViewSelection,
): DockViewType {
  const candidates = [selection.fromUrl, selection.startupTab, selection.lastTab];

  for (const candidate of candidates) {
    if (isDockViewType(candidate) && tabs.includes(candidate)) return candidate;
  }

  return tabs[0];
}

/**
 * タブ一覧の出し入れ。**外せないビューには何もしない。**
 *
 * 足す先を末尾にするのは、押した行がその場で消えたり割り込んだりしないため。
 * 並べたい人は続けて [`moveDockTab`] を押す。
 */
export function toggleDockTab(tabs: readonly DockViewType[], key: DockViewType): DockViewType[] {
  if (!tabs.includes(key)) return [...tabs, key];
  if (dockViewMeta(key)?.removable === false) return [...tabs];
  return tabs.filter((t) => t !== key);
}

/**
 * タブ一覧の並べ替え。**端で押しても何も起きない**（隣と入れ替えるだけ）。
 */
export function moveDockTab(
  tabs: readonly DockViewType[],
  key: DockViewType,
  direction: -1 | 1,
): DockViewType[] {
  const at = tabs.indexOf(key);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= tabs.length) return [...tabs];

  const next = [...tabs];
  next[at] = next[to];
  next[to] = key;
  return next;
}
