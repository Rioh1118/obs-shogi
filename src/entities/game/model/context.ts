import { createContext } from "react";
import type { GameContextType } from "./types";

export const GameContext = createContext<GameContextType | null>(null);

/**
 * 盤に載っている棋譜のパス。ツリーの行のような数の多い部品のために `GameContext` と分ける。
 *
 * `GameContext` の value は `state` と `view` から作られるので、カーソルが動くたびと
 * マスを選ぶたびに同一性が変わる。行がそれを読むと、盤の操作で全部の行が描き直される。
 *
 * こちらの値はプリミティブで、動くのは `game_loaded` / `reset_state` / `path_renamed` の
 * 3つだけ。改名と移動でも動き、そのときはツリーの全行が描き直される。
 * **オブジェクトを詰めないこと。** 同一性が毎回変わり、分けた意味が無くなる。
 *
 * 既定値の `undefined` は「provider の外」を表す。`null` は「何も載っていない」で、
 * 別の意味を持つ（`useLoadedKifuPath` が投げ分ける）。
 */
export const LoadedKifuPathContext = createContext<string | null | undefined>(undefined);
