import { useContext } from "react";
import { GameContext, LoadedKifuPathContext } from "./context";

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

/**
 * 盤に載っている棋譜のパスを返す。何も載っていなければ `null`。
 *
 * 載っている棋譜しか要らない部品はこちらを使う。`useGame()` は盤の操作のたびに
 * 描き直されるので、ツリーの行のような数の多い部品が読むと全部の行が描き直される。
 *
 * provider の外では投げる。黙って `null` を返すと「何も載っていない」と区別が付かない。
 */
export function useLoadedKifuPath(): string | null {
  const path = useContext(LoadedKifuPathContext);
  if (path === undefined) {
    throw new Error("useLoadedKifuPath must be used within GameProvider");
  }
  return path;
}
