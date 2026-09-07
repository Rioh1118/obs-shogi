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
 * 移動を始められたか。始められなかったときは**理由まで返す**——
 * ツリーそのものがまだ無いのと、ツリーにその棋譜が無いのは別の失敗で、
 * 前者は読み込めれば同じ操作で開ける（呼び手が段と文言を分けられるように）
 */
export type NavigationOutcome = "started" | "not-in-tree" | "tree-unavailable";

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
  const { fileTree, selectedNode, selectNodeByAbsPath, kifuError } = useFileTree();
  const { state: gameState, view: gameView, applyCursor } = useGame();

  const pendingRef = useRef<PendingNav | null>(null);

  const startNavigationToHit = useCallback(
    (absPath: string, cursor: CursorLite): NavigationOutcome => {
      pendingRef.current = { absPath, cursor };

      // すでにその棋譜が**盤に載っていて**、view.player もあるなら即ジャンプ。
      //
      // **`selectedNode` だけで判定しない。** ツリーの選択は即座に切り替わるのに
      // `view.player` は盤に載っている棋譜の再生器なので、選択だけを見ると
      // 読み込みの飛行中や盤に載せられなかった棋譜（#434）で
      // **前の棋譜に別の棋譜のカーソルを当てて成功を返す**。
      //
      // **`state.isLoading` は見ない。** あれは `blockingWrites > 0` の射影
      // （`entities/game/model/types.ts`）で、棋譜の読み込み中には立たない。
      // 読み込みの飛行中を実際に弾いているのは `loadedAbsPath` の一致で、
      // 条件は下の effect（着いてから当てる側）と同じ2つにしてある
      if (
        selectedNode &&
        !selectedNode.isDirectory &&
        selectedNode.path === absPath &&
        gameState.loadedAbsPath === absPath &&
        gameView.player
      ) {
        applyCursor(cursorFromLite(cursor));
        pendingRef.current = null;
        return "started";
      }

      // ツリーを1本も持っていなければ、探した結果ではない。
      // `findNodeByPath` は `fileTree` が null なら必ず null を返すので、
      // ここで分けないと「読み込めていない」が「棋譜が無い」に化ける
      if (!fileTree) {
        pendingRef.current = null;
        return "tree-unavailable";
      }

      // **盤に載っていないなら必ず開き直させる。** ツリー側の「もう開いている」は
      // 構文として読めたことしか言わないので、盤に載せられなかった棋譜は
      // 2度目以降の要求で `openKifuNode` ごと飛ばされる。飛ばされると
      // `jkfData` の同一性も `activeKifuPath` も動かず、載せ直しの effect が
      // 走らないので**モーダルだけが閉じて何も起きない**。
      const forceReopen = gameState.loadedAbsPath !== absPath;

      if (!selectNodeByAbsPath(absPath, { forceReopen })) {
        pendingRef.current = null;
        return "not-in-tree";
      }

      return "started";
    },
    [
      applyCursor,
      fileTree,
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
    if (!gameView.player) return;
    if (gameState.loadedAbsPath !== p.absPath) return;

    applyCursor(cursorFromLite(p.cursor));
    pendingRef.current = null;
  }, [applyCursor, gameView.player, gameState.loadedAbsPath, kifuError, selectedNode]);

  return { startNavigationToHit };
}
