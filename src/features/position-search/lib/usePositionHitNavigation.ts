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
 * **返すのは「移動を始められたか」であって「開けたか」ではない。** 索引に在る棋譜が
 * ツリーに無いのは正常運転で起こる（理由は
 * `docs/state-transitions/search.md` の「走査が失敗しても `Y` に上がる」）。
 * 呼び手が戻り値を捨てると、盤が動かないまま「開いた」ように見える経路になる
 */
export function usePositionHitNavigation() {
  const { selectedNode, selectNodeByAbsPath, kifuError } = useFileTree();
  const { state: gameState, view: gameView, applyCursor } = useGame();

  const pendingRef = useRef<PendingNav | null>(null);

  const startNavigationToHit = useCallback(
    (absPath: string, cursor: CursorLite): boolean => {
      pendingRef.current = { absPath, cursor };

      // すでにその棋譜が**盤に載っていて**、view.player もあるなら即ジャンプ。
      //
      // **`selectedNode` だけで判定しない。** ツリーの選択は即座に切り替わるのに
      // `view.player` は盤に載っている棋譜の再生器なので、選択だけを見ると
      // 読み込みの飛行中や盤に載せられなかった棋譜（#434）で
      // **前の棋譜に別の棋譜のカーソルを当てて成功を返す**。
      // 条件は下の effect（着いてから当てる側）と同じにしてある
      if (
        selectedNode &&
        !selectedNode.isDirectory &&
        selectedNode.path === absPath &&
        !gameState.isLoading &&
        gameState.loadedAbsPath === absPath &&
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
    [
      applyCursor,
      gameState.isLoading,
      gameState.loadedAbsPath,
      gameView.player,
      selectNodeByAbsPath,
      selectedNode,
    ],
  );

  // ファイル切替 → 読み込み完了（view.player が立つ）を待ってから applyCursor
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;

    // **流れた要求は捨てる。** このフックはモーダルごと常時マウントされている
    // （`AppModalLayer`）ので、捨てないと要求はアプリを終えるまで生き残り、
    // あとでその棋譜を普通に開いた瞬間に、誰も頼んでいない局面へ盤が動く。
    // 見分けは2つ——利用者が別の棋譜を選んだ／その棋譜を読めなかった
    if (selectedNode && !selectedNode.isDirectory && selectedNode.path !== p.absPath) {
      pendingRef.current = null;
      return;
    }
    if (kifuError?.path === p.absPath) {
      pendingRef.current = null;
      return;
    }

    if (!selectedNode || selectedNode.isDirectory) return;
    if (gameState.isLoading) return;
    if (!gameView.player) return;
    if (gameState.loadedAbsPath !== p.absPath) return;

    applyCursor(cursorFromLite(p.cursor));
    pendingRef.current = null;
  }, [
    applyCursor,
    gameState.isLoading,
    gameView.player,
    gameState.loadedAbsPath,
    kifuError,
    selectedNode,
  ]);

  return { startNavigationToHit };
}
