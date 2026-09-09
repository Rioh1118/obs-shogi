import { useContext } from "react";
import { GameContext, LoadedKifuPathContext } from "./context";

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

/**
 * 盤に載っている棋譜のパス。**載っている棋譜しか要らない部品はこちらを使う。**
 *
 * `useGame()` を読むと盤の操作のたびに描き直される。数が多い部品（ツリーの行）が
 * それをやると、盤を1手動かすだけで無関係な行が全部描き直される。
 *
 * `null` は「何も載っていない」。provider の外で呼ぶと投げる（`useGame` と同じ理由で、
 * 囲い忘れを黙った `null` にすると「何も載っていない」と区別が付かない）。
 */
export function useLoadedKifuPath(): string | null {
  const path = useContext(LoadedKifuPathContext);
  if (path === undefined) {
    throw new Error("useLoadedKifuPath must be used within GameProvider");
  }
  return path;
}
