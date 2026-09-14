import { createContext } from "react";
import type { Side } from "../api/rust-types";
import type { GameSessionView, GameStartRequest } from "./types";

export interface GameSessionContextValue {
  view: GameSessionView;
  /**
   * 対局を始める。**解決まで数十秒かかりうる**（評価関数の重いエンジン）。
   * 取り消す口は無い。**走っている対局があるあいだは何もしない**
   */
  start: (request: GameStartRequest) => Promise<void>;
  /**
   * 投了。**人が座っている席しか投げられない**——エンジンの席を指すと Rust が断るので、
   * エンジン同士の対局に投了の口は無い
   */
  resign: (side: Side) => Promise<void>;
  /** 中断。勝敗が付かずに終わる */
  abort: () => Promise<void>;
  /**
   * 閉じてエンジンを落とす。**呼ぶまでプロセスは残る**（終局は落とさない）。
   *
   * **1押しで終わるとは限らない**——「止める → 畳み待ち → 落とす」の順で、
   * 取り込みに失敗すると `Err` が返る。
   */
  close: () => Promise<void>;
}

export const GameSessionContext = createContext<GameSessionContextValue | null>(null);
