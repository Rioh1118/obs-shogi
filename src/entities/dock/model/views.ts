import type { DockViewType } from "@/shared/lib/router/useURLParams";

/**
 * ドックのタブになれるビュー1枚の素性
 *
 * 部品は持たない。持たせると、この名簿は `widgets/` を読むことになり、設定画面
 * （`features/`）から読めなくなる。綴りから部品への割り当ては `src/pages/dockViews.ts` が持つ。
 */
export type DockViewMeta = {
  key: DockViewType;
  /** タブに出る見出し */
  label: string;
  /** タブ一覧から外せるか */
  removable: boolean;
  /** 設定を持たない利用者のタブ一覧に出すか */
  defaultVisible: boolean;
};

/**
 * 綴りごとの素性。`DockViewType` を1つ足してここへ足さないと tsc が落ちる。
 *
 * 配列で持つと網羅が閉じない。`satisfies readonly DockViewMeta[]` は全部の綴りが並んでいるかを
 * 見ない。落とした綴りは `resolveDockTabs` が捨てるので、部品まで書いたのにタブ列にも設定にも
 * 出ないまま、どこも赤くならない。
 */
const SPECS = {
  analysis: {
    label: "検討",
    // 全部外せると「空のドック」という状態が生まれ、そこに出す案内が要る（ADR-0010 決定1）
    removable: false,
    defaultVisible: true,
  },
  book: {
    label: "定跡",
    removable: true,
    // 定跡を開いていなくても出す。開く経路はこのビューの中にしか無い
    defaultVisible: true,
  },
} as const satisfies Record<DockViewType, Omit<DockViewMeta, "key">>;

/** ドックのビューの名簿。並びは `SPECS` の宣言順で、利用者が並べ替えるまではこの順にタブが出る */
export const DOCK_VIEWS: readonly DockViewMeta[] = Object.keys(SPECS).map((key) => {
  // `Object.keys` は `string[]` を返す。鍵の集合は `SPECS` の型が閉じているので、
  // ここで名乗り直しても綴りが増えることはない
  const viewKey = key as DockViewType;
  return { key: viewKey, ...SPECS[viewKey] };
});

/** 名簿の1枚。綴りが名簿に無ければ `undefined` */
export function dockViewMeta(key: DockViewType): DockViewMeta | undefined {
  return DOCK_VIEWS.find((v) => v.key === key);
}

/** タブに出す見出し。名簿に無ければ綴りをそのまま出す */
export function dockViewLabel(key: DockViewType): string {
  return dockViewMeta(key)?.label ?? key;
}
