import { useCallback, useEffect, useRef } from "react";

import type { CursorLite } from "@/commands/search/types";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { useGame } from "@/entities/game";
import { cursorFromLite } from "@/entities/search/lib/cursorAdapter";

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
  const { state: gameState, applyCursor } = useGame();

  const pendingRef = useRef<PendingNav | null>(null);

  const navigateToHit = useCallback(
    (absPath: string, cursor: CursorLite) => {
      pendingRef.current = { absPath, cursor };

      // すでにそのファイルが開かれていて、jkfPlayer もあるなら即ジャンプ
      if (
        selectedNode &&
        !selectedNode.isDirectory &&
        selectedNode.path === absPath &&
        gameState.jkfPlayer
      ) {
        applyCursor(cursorFromLite(cursor));
        pendingRef.current = null;
        return;
      }

      // 別ファイルなら FileTree を切り替える（ロード完了は useEffect で待つ）
      selectNodeByAbsPath(absPath);
    },
    [applyCursor, gameState.jkfPlayer, selectNodeByAbsPath, selectedNode],
  );

  // ファイル切替 → 読み込み完了（jkfPlayer が立つ）を待ってから applyCursor
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;

    if (!selectedNode || selectedNode.isDirectory) return;
    if (selectedNode.path !== p.absPath) return;
    if (gameState.isLoading) return;
    if (!gameState.jkfPlayer) return;
    if (gameState.loadedAbsPath !== p.absPath) return;

    applyCursor(cursorFromLite(p.cursor));
    pendingRef.current = null;
  }, [
    applyCursor,
    gameState.isLoading,
    gameState.jkfPlayer,
    gameState.loadedAbsPath,
    selectedNode,
  ]);

  return { navigateToHit };
}
