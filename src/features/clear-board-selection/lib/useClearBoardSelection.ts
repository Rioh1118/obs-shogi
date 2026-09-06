import { useCallback } from "react";
import type { PointerEvent } from "react";
import { useGame } from "@/entities/game";
import { INSIDE_BOARD_SELECTOR } from "./boardMarkers";

/**
 * 盤の外を押したら駒の選択を外す。返すのは `onPointerDownCapture` に付けるハンドラ。
 *
 * **捕まえる位置はページの根で正しい。** 「盤の外」は盤より広い範囲を見ないと
 * 判定できないので、盤の中では捕まえられない。ページが持つのは付ける場所だけで、
 * 盤の内側かどうかの判定は [boardMarkers](./boardMarkers.ts) が持つ。
 */
export function useClearBoardSelection() {
  const { state, clearSelection } = useGame();
  const hasSelection = state.selectedPosition !== null;

  return useCallback(
    (e: PointerEvent) => {
      if (!hasSelection) return;

      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest(INSIDE_BOARD_SELECTOR)) return;

      clearSelection();
    },
    [hasSelection, clearSelection],
  );
}
