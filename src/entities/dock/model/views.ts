import type { DockViewType } from "@/shared/lib/router/useURLParams";

/**
 * ドックのタブになれるビュー1枚の素性。**部品は持たない。**
 *
 * 部品を持たせると、この名簿は `widgets/` を読むことになり、
 * 設定画面（`features/`）から読めなくなる。**綴り・見出し・既定だけをここに置き、
 * 綴りから部品への割り当ては `src/pages/dockViews.ts` が持つ。**
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
 * 綴りごとの素性。**`Record` にしてあるので、`DockViewType` を1つ足して
 * ここへ足さないと tsc が落ちる。**
 *
 * 配列で持つと網羅が閉じない —— `satisfies readonly DockViewMeta[]` が見るのは
 * 「並んでいる行の綴りが `DockViewType` に在るか」だけで、逆向き（全部の綴りが
 * 並んでいるか）は見ない。落とした綴りは `resolveDockTabs` が常に捨てるので、
 * **部品まで書いたのにタブ列にも設定にも出ないまま、どこも赤くならない。**
 */
const SPECS = {
  analysis: {
    label: "解析",
    // **外せない。** 全部外せると「空のドック」という状態が生まれ、
    // そこに出す案内を設計することになる（ADR-0010 決定1）
    removable: false,
    defaultVisible: true,
  },
  book: {
    label: "定跡",
    removable: true,
    // **定跡を開いていなくても出す。** 出さないと、定跡を開く導線が
    // どこにも無い状態から始まる（開く口はこのビューの中にしか無い）
    defaultVisible: true,
  },
} as const satisfies Record<DockViewType, Omit<DockViewMeta, "key">>;

/**
 * ドックのビューの名簿。**並びは既定の並び順**（`SPECS` の宣言順）で、
 * 利用者が並べ替えるまではこの順にタブが出る。
 */
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

/** タブに出す見出し。名簿に無い綴りは綴りそのものを出す（`dock=` は誰でも書ける） */
export function dockViewLabel(key: DockViewType): string {
  return dockViewMeta(key)?.label ?? key;
}
