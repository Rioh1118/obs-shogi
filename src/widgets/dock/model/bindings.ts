import type { ComponentType } from "react";
import type { DockViewType } from "@/shared/lib/router/useURLParams";
import type { BoundaryLabel } from "@/shared/ui/AppErrorBoundary";

/** ビュー1枚の部品。**素性（見出し・既定）は `entities/dock` が持つ。** */
export type DockViewBinding = {
  /** ドックの本体に出るもの */
  Body: ComponentType;
  /**
   * タブ列の隣に出る操作列。**他のビューの操作をここへ混ぜない。**
   *
   * 混ぜると、そのビューを見ていない間も操作だけが残る。盤の道具が解析ペインの
   * ヘッダに居たときに起きていたのがこれ（ADR-0010）。
   */
  Controls: ComponentType;
  /** 本体が落ちたときの名乗り */
  boundary: BoundaryLabel;
  /** 畳んだときに出す次の一手 */
  fallbackHint: string;
};

/**
 * 綴りからビューの部品へ。**`Record` なので、綴りを足して部品を足さないと tsc が落ちる。**
 *
 * **中身をここで決めない。** 決めると `widgets/dock` が全部のビューのスライスを読むことになり、
 * 「widgets に同層横断を1組も作らない」（`src/__tests__/crossSliceImports.test.ts`）を破る。
 * 割り当ての現物は `src/pages/dockViews.ts` が持ち、`Dock` へ渡す。
 */
export type DockViewBindings = Record<DockViewType, DockViewBinding>;
