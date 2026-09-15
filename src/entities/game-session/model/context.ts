import { createContext } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import type { Side } from "../api/rust-types";
import type { GameSessionView, GameStartRequest } from "./types";

/**
 * 対局への口。
 *
 * **`start` 以外は `AsyncResult` を返す。** 断りは Rust の文言でしか理由が分からず、
 * 捨てると「押したのに何も起きない」だけが残る。投げずに値で返すことで、
 * 読み落としを `src/__tests__/asyncResultUse.test.ts` が拾える形になる。
 */
export interface GameSessionContextValue {
  view: GameSessionView;
  /**
   * 対局を始める。**解決まで数十秒かかりうる**（評価関数の重いエンジン）。
   * 取り消す口は無い。
   *
   * **断りは `view` に載る**ので戻り値を持たない —— 始められなかったことは
   * `failed` として、始めなかったことは `view` が `idle` 以外のままであることで分かる。
   */
  start: (request: GameStartRequest) => Promise<void>;
  /**
   * 対局の手を棋譜へ積めなかったことを伝える。**`null` で取り消す。**
   *
   * 積む側（`features/game-move`）は何も描かないので、出す場所がここにしか無い。
   * **対局は止まらない**（Rust の写しで進む）ので、黙ると棋譜だけが遅れ、
   * 終局後に開き直したとき初めて後半が無いことに気づく。
   */
  reportBoardFailure: (message: string | null) => void;
  /**
   * 人の着手を出す。**解決したことが「採られた」の意味。**
   *
   * 着手が届くのと持ち時間が尽きるのが同じ tick に入ると断られる（`moveDecided` は
   * 出ず、代わりに `over { reason: "timeout" }` が届く）。
   * **棋譜へ積むのは解決してからにすること。**
   *
   * **断り方の1つだけは呼び直してよい** —— 裁定の往復の窓
   * （`a ruling is still pending`）は、人対人なら毎手ある。
   */
  submitMove: (side: Side, usiMove: string) => AsyncResult<void>;
  /**
   * 投了。**人が座っている席しか投げられない**——エンジンの席を指すと Rust が断るので、
   * エンジン同士の対局に投了の口は無い。
   */
  resign: (side: Side) => AsyncResult<void>;
  /** 中断。勝敗が付かずに終わる */
  abort: () => AsyncResult<void>;
  /**
   * 閉じてエンジンを落とす。**呼ぶまでプロセスは残る**（終局は落とさない）。
   *
   * **1押しで終わるとは限らない**——「止める → 畳み待ち → 落とす」の順で、
   * 取り込みに失敗すると断られる。**断られたら対局は画面に残る**ので、
   * そのまま押し直せる（捨てるとエンジンが残ったまま画面だけが「対局なし」になる）。
   */
  closeSession: () => AsyncResult<void>;
}

export const GameSessionContext = createContext<GameSessionContextValue | null>(null);
