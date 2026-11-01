import { createContext } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import type { Side } from "../api/rust-types";
import type { GameSessionView, GameStartRequest, StartRefusal } from "./types";

/**
 * 対局の姿と、対局への操作。
 *
 * Rust へ送る操作は `AsyncResult` を返す。断りの理由は Rust の文言でしか分からず、
 * 投げずに値で返すと読み落としを `src/__tests__/asyncResultUse.test.ts` が拾える。
 */
export type GameSessionContextValue = {
  view: GameSessionView;
  /**
   * 対局を始める。解決まで数十秒かかることがある（評価関数の重いエンジン）。
   *
   * 戻り値を持たない。始められなかったことは `view` の `failed` で分かる。
   * `startRefusal` に断られたときは何も起きず、`view` は変わらない。
   */
  start: (request: GameStartRequest) => Promise<void>;
  /**
   * いま始められない理由を返す。`null` なら始められる。
   *
   * 棋譜を作る前に呼ぶ。`start` は断っても何も起きないので、先に作ると
   * 対局していない棋譜が1枚できる。`view` から判定し直さない。`view` は描画時の写しで、
   * 購読の成否が決まる前に呼ぶと張れていると読む。
   */
  startRefusal: () => Promise<StartRefusal | null>;
  /**
   * 対局の手を棋譜へ積めなかったことを `view` の `boardFailure` に載せる。`null` で取り消す。
   *
   * 積む側（`features/game-move`）は何も描かないので、ここを通して伝える。
   */
  reportBoardFailure: (message: string | null) => void;
  /**
   * 人の着手を送る。`Ok` なら Rust が採った手で、棋譜へ積むのはその後にする。
   *
   * `Err` の手は棋譜へ積まない。断りの種類は `api/tauri.ts` の `submitGameMove` にある。
   */
  submitMove: (side: Side, usiMove: string) => AsyncResult<void>;
  /** 投了する。Rust はエンジンの席の投了を断るので、エンジン同士の対局では使えない */
  resign: (side: Side) => AsyncResult<void>;
  /** 勝敗を付けずに終局する */
  abort: () => AsyncResult<void>;
  /**
   * 対局を手放す。エンジンが残っていれば `closeGame` で畳んでから手放す。
   *
   * 断られたら対局は `view` に残るので呼び直せる。先に手放すと、エンジンが
   * 残ったまま `view` だけが `idle` に戻る。走っている対局は、Rust が畳む前に中断を
   * 通すので `over` へ移ることがある。
   *
   * `startGame` の解決を待っている間に呼ぶと、手放した対局は解決した時点で畳む。
   */
  closeSession: () => AsyncResult<void>;
};

export const GameSessionContext = createContext<GameSessionContextValue | null>(null);
