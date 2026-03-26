import { useCallback, useEffect, useRef } from "react";

import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { useGame } from "@/entities/game";
import { cursorFromLite } from "@/entities/search/lib/cursorAdapter";
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
 *   GameContext がそのファイルを load して jkfPlayer が用意できたら applyCursor
 */
export function usePositionHitNavigation() {
  const { selectedNode, selectNodeByAbsPath } = useFileTree();
  const { state: gameState, view: gameView, applyCursor } = useGame();

  const pendingRef = useRef<PendingNav | null>(null);

  const navigateToHit = useCallback(
    (absPath: string, cursor: CursorLite) => {
      pendingRef.current = { absPath, cursor };

      // すでにそのファイルが開かれていて、jkfPlayer もあるなら即ジャンプ
      if (
        selectedNode &&
        !selectedNode.isDirectory &&
        selectedNode.path === absPath &&
        gameView.player
      ) {
        applyCursor(cursorFromLite(cursor));
        pendingRef.current = null;
        return;
      }

      const ok = selectNodeByAbsPath(absPath);
      if (!ok) {
        pendingRef.current = null;
        return;
      }
    },
    [applyCursor, gameView.player, selectNodeByAbsPath, selectedNode],
  );

  // ファイル切替 → 読み込み完了（jkfPlayer が立つ）を待ってから applyCursor
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
