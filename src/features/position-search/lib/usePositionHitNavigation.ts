import { useCallback, useEffect, useRef } from "react";

import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { cursorFromLite } from "@/entities/search";
import type { CursorLite } from "@/entities/search";

type PendingNav = {
  absPath: string;
  cursor: CursorLite;
};

/**
 * 検索ヒット -> (必要ならファイルを開く) -> 指定局面へ applyCursor
 *
 * - 同一ファイルなら即 applyCursor
 * - 別ファイルなら selectNodeByAbsPath で FileTree を切り替え、
 *   GameContext がそのファイルを load して view.player が立ったら applyCursor
 *
 * **`navigateToHit` は移動を始められたかを返す。** 索引に在る棋譜がツリーに無いのは
 * 正常運転で起こる——`run_rescan_diff_apply` は `scan_kifu_files` が失敗すると
 * 削除の取り込みに届く前に戻るので、消えた棋譜が索引に残る。呼び手が戻り値を捨てると、
 * 盤が動かないまま「開いた」ように見える経路になる
 */
export function usePositionHitNavigation() {
  const { selectedNode, selectNodeByAbsPath } = useFileTree();
  const { state: gameState, view: gameView, applyCursor } = useGame();

  const pendingRef = useRef<PendingNav | null>(null);

  const navigateToHit = useCallback(
    (absPath: string, cursor: CursorLite): boolean => {
      pendingRef.current = { absPath, cursor };

      // すでにそのファイルが開かれていて、view.player もあるなら即ジャンプ
      if (
        selectedNode &&
        !selectedNode.isDirectory &&
        selectedNode.path === absPath &&
        gameView.player
      ) {
        applyCursor(cursorFromLite(cursor));
        pendingRef.current = null;
        return true;
      }

      if (!selectNodeByAbsPath(absPath)) {
        pendingRef.current = null;
        return false;
      }

      return true;
    },
    [applyCursor, gameView.player, selectNodeByAbsPath, selectedNode],
  );

  // ファイル切替 → 読み込み完了（view.player が立つ）を待ってから applyCursor
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;

    if (!selectedNode || selectedNode.isDirectory) return;
    if (selectedNode.path !== p.absPath) return;
    if (gameState.isLoading) return;
    if (!gameView.player) return;
    if (gameState.loadedAbsPath !== p.absPath) return;

    applyCursor(cursorFromLite(p.cursor));
    pendingRef.current = null;
  }, [applyCursor, gameState.isLoading, gameView.player, gameState.loadedAbsPath, selectedNode]);

  return { navigateToHit };
}
