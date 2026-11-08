import type { ReactNode } from "react";
import { BookProvider } from "@/entities/book";
import { useGame } from "@/entities/game";

/**
 * 盤の現局面を `BookProvider` へ渡す。
 *
 * `entities/book` に `useGame` を読ませない。読ませると `entities` どうしの
 * 横断になる（`src/__tests__/crossSliceImports.test.ts` の許可リスト）。
 * 共有したいのは値1つなので、上から prop で渡す形にする。
 *
 * `BookProvider` の置き場を決めているのはこのファイル。
 * **ドックより上に置くこと。** 定跡ビューの中で provider を持つと、
 * タブを移るたびに定跡が閉じて開き直され、GB 級のファイルでは
 * タブの移動そのものが止まる（→ `docs/state-transitions/book-view.md` ※B）。
 * 棋譜の有無で unmount されない位置であることも要る（unmount されると開いた定跡が閉じる）。
 */
export function BookPositionGate({ children }: { children: ReactNode }) {
  const { view } = useGame();

  return <BookProvider currentSfen={view.currentSfen}>{children}</BookProvider>;
}
