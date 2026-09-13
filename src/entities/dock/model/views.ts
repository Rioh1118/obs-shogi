import type { DockViewType } from "@/shared/lib/router/useURLParams";

/**
 * ドックのタブになれるビュー1枚の素性。**部品は持たない。**
 *
 * 部品を持たせると、この名簿は `widgets/` を読むことになり、
 * 設定画面（`features/`）から読めなくなる。**綴り・見出し・既定だけをここに置き、
 * 綴りから部品への割り当ては `widgets/dock` が持つ。**
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
 * ドックのビューの名簿。**綴りは URL の語彙（`DockViewType`）に合わせる。**
 *
 * 合わせないと、ここを増やしても `dock=` に書ける綴りが増えず、
 * 書いた先で既定のタブに落ちる。
 *
 * **並びは既定の並び順でもある。** 利用者が並べ替えるまではこの順にタブが出る。
 */
export const DOCK_VIEWS = [
  {
    key: "analysis",
    label: "解析",
    // **外せない。** 全部外せると「空のドック」という状態が生まれ、
    // そこに出す案内を設計することになる（ADR-0010 決定1）
    removable: false,
    defaultVisible: true,
  },
] as const satisfies readonly DockViewMeta[];

/** 名簿の1枚。綴りが名簿に無ければ `undefined` */
export function dockViewMeta(key: DockViewType): DockViewMeta | undefined {
  return DOCK_VIEWS.find((v) => v.key === key);
}
