import type { ReactNode } from "react";
import { BookProvider } from "@/entities/book";
import { useGame } from "@/entities/game";

/**
 * 盤の現局面を `BookProvider` へ渡す。
 *
 * **`entities/book` に `useGame` を読ませない。** 読ませると `entities` どうしの
 * 横断になる（`src/__tests__/crossSliceImports.test.ts` の控え）。
 * 共有したいのは値1つなので、上から prop で渡す形にする。
 *
 * **ドックより上に置くこと。** 定跡ビューの中で provider を持つと、
 * タブを移るたびに定跡が閉じて開き直される
 * （→ `docs/state-transitions/book-view.md` ※B）。
 */
export function BookPositionGate({ children }: { children: ReactNode }) {
  const { view } = useGame();

  return <BookProvider currentSfen={view.currentSfen}>{children}</BookProvider>;
}
