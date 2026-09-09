import { createContext } from "react";
import type { GameContextType } from "./types";

export const GameContext = createContext<GameContextType | null>(null);

/**
 * 盤に載っている棋譜のパスだけ。**`GameContext` とは別に置く。**
 *
 * `GameContext` の value は `state` と `view` から作られるので、カーソルが1手動くたび・
 * 盤のマスを選ぶたびに同一性が変わり、購読している部品が全員描き直される。
 * ツリーの行のように**数が多くて、載っている棋譜しか要らない**部品がそこに混ざると、
 * 盤を操作するだけで無関係な行が全部描き直される。
 *
 * こちらの値はプリミティブで、動くのは `game_loaded` と `reset_state` のときだけ。
 * **オブジェクトを詰めないこと**——詰めると分けた意味が無くなる。
 *
 * 既定値の `undefined` は「provider の外」を表す。`null` は「何も載っていない」で、
 * 別の意味を持つ（`useLoadedKifuPath` が投げ分ける）。
 */
export const LoadedKifuPathContext = createContext<string | null | undefined>(undefined);
