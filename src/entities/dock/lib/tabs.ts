import type { DockViewType } from "@/shared/lib/router/useURLParams";
import { DOCK_VIEWS, dockViewMeta } from "../model/views";

/**
 * 保存されている綴りが名簿に在るか。
 *
 * 設定ファイルは手で書けるし、前の版が書いた綴りも残る。名簿に無い綴りを画面へ渡すと、
 * 割り当ての無いタブが出て中身が空になる。
 */
function isDockViewType(value: unknown): value is DockViewType {
  return typeof value === "string" && DOCK_VIEWS.some((v) => v.key === value);
}

/** 保存や URL の綴りが、いまのタブ一覧に在るか */
function isListed(tabs: readonly DockViewType[], value: unknown): value is DockViewType {
  return isDockViewType(value) && tabs.includes(value);
}

/**
 * タブ一覧を組む。返る一覧は1枚以上ある。
 *
 * 1枚以上を保証しているのは名簿の側で、`removable: false` のビューが1枚以上あることを
 * ADR-0010 決定1 が要求し、`src/entities/dock/model/__tests__/views.test.ts` が固定している。
 *
 * - `saved` は設定に残っている並び（`AppConfig.dock_tabs`）。まだ選んでいなければ `null` で、
 *   名簿の `defaultVisible` が決める。名簿に無い綴りは捨てる
 * - `known` はその `saved` を選んだときに名簿にあった綴り（`AppConfig.dock_tabs_known`）。
 *   `known` に無いビューは選ぶ機会が無かったものなので、`defaultVisible` なら足す
 * - 外せないビューは、`saved` が落としていても入れ直す。空のドックを作らないため
 *
 * `known` を見ないと、設定「表示」を一度でも触った利用者には新しいビューが永久に出ない。
 * 定跡を開く経路は定跡ビューの中にしか無いので、機能ごと到達できなくなる。
 */
export function resolveDockTabs(
  saved: readonly string[] | null | undefined,
  known: readonly string[] | null | undefined,
): DockViewType[] {
  const chosen =
    saved == null
      ? DOCK_VIEWS.filter((v) => v.defaultVisible).map((v) => v.key)
      : saved.filter(isDockViewType);

  const tabs: DockViewType[] = [];
  for (const key of chosen) {
    if (!tabs.includes(key)) tabs.push(key);
  }

  // `known` が欠けている設定は「何も知らなかった」として扱う。外した意思を1度だけ取り消す
  // ことになるが、黙って出ないままにするより戻しやすい
  if (saved != null) {
    for (const view of DOCK_VIEWS) {
      if (!view.defaultVisible) continue;
      if (known?.includes(view.key) === true) continue;
      if (!tabs.includes(view.key)) tabs.push(view.key);
    }
  }

  for (const view of DOCK_VIEWS) {
    if (!view.removable && !tabs.includes(view.key)) tabs.push(view.key);
  }

  return tabs;
}

/** いま名簿にあるビューの綴り。選んだ結果と一緒に残す（`resolveDockTabs` の `known`） */
export function knownDockViews(): DockViewType[] {
  return DOCK_VIEWS.map((view) => view.key);
}

/**
 * 起動時に開くと決めてあるタブを返す。一覧に無ければ `null` で、前回のものを開く。
 *
 * 読む側と書く側の両方がこれを通る。通さないと、固定に選んだタブを一覧から外した後に、
 * 設定画面は選択肢に無い値を表示し、起動時の行き先だけが別になる。
 */
export function resolveStartupTab(
  tabs: readonly DockViewType[],
  saved: string | null | undefined,
): DockViewType | null {
  return isListed(tabs, saved) ? saved : null;
}

/** どのビューを出すかを決める材料 */
type DockViewSelection = {
  /** URL の `dock=`。無ければ `undefined` */
  fromUrl?: string | null;
  /** 起動時に開くタブ。`null` は前回のもの */
  startupTab?: string | null;
  /** 前回開いていたタブ */
  lastTab?: string | null;
};

/**
 * いま出すビューを `tabs` の中から決める。
 *
 * 順に、URL の綴り、起動時に開くと決めてあるタブ、前回開いていたタブ、一覧の先頭。
 * 一覧に無い綴りは飛ばす。一覧から外したタブが URL や設定に残っているだけで、
 * タブ列に無いものが本体に出るのを防ぐ。
 *
 * `tabs` は `resolveDockTabs` が返した空でない一覧を渡す。
 */
export function resolveDockView(
  tabs: readonly DockViewType[],
  selection: DockViewSelection,
): DockViewType {
  const candidates = [selection.fromUrl, selection.startupTab, selection.lastTab];

  for (const candidate of candidates) {
    if (isListed(tabs, candidate)) return candidate;
  }

  return tabs[0];
}

/**
 * タブ一覧からビューを出し入れした一覧を返す。外せないビューは外れない。
 *
 * 足す先は末尾。押した行がその場で消えたり割り込んだりしないため。
 */
export function toggleDockTab(tabs: readonly DockViewType[], key: DockViewType): DockViewType[] {
  if (!tabs.includes(key)) return [...tabs, key];
  if (dockViewMeta(key)?.removable === false) return [...tabs];
  return tabs.filter((t) => t !== key);
}

/** 隣と入れ替えた一覧を返す。端で押しても何も起きない */
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
