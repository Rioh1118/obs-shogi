import { useCallback, useRef, type Dispatch, type RefObject } from "react";
import type { AnalysisResult } from "@/entities/engine";
import type { AnalysisAction } from "./types";
import { waits } from "./waits";

/**
 * 届いた解析結果を間引いて画面へ流す面
 *
 * 反映待ちを1本だけ持ち、タイマーが起きたときの最新を出す。反映待ちとタイマーは1組で、
 * 片方だけ落とすと、捨てた結果が次のタイマーで別の局面の解析結果として画面に出る。
 * 席を握れなかった経路は `dropPending` を通すこと。
 */
type ResultFlush = {
  /** 届いた結果を反映待ちに置き、間引きのタイマーを張る */
  receive: (result: AnalysisResult) => void;
  /**
   * 反映待ちと間引きのタイマーを両方落とす。画面の候補手には触らない（それは `discardShown`）。
   *
   * 主の保証は `commitLatest` の席の判定で、ここは席の判定が通ってしまう場合を塞ぐ。
   * 捨てる停止が落ちると `keepOrForget` が席を欄へ書き戻すので、掃除と読んで呼びを外さないこと
   * （`provider.tsx` の `dropPendingForLostSeat`）。
   */
  dropPending: () => void;
  /**
   * 画面の候補手ごと捨てる。開始する経路は `go` を出す前に必ず通す。
   *
   * 通さないと、`start_analysis` は `analyzedSfen` だけを差し替えるので、新しい席の最初の `info` まで
   * 前の局面の読み筋が新しい局面の解析結果として出る。`AnalysisPane` がそれを控えへ入れると、
   * 停止中に戻るたびに出続ける。
   *
   * **要求の世代の判定の後ろで呼ぶこと。** `clear_results` は `error` も消す。
   */
  discardShown: () => void;
  /**
   * タイマーが張られていなければ張る。席を握った直後に呼ぶ。
   *
   * 席が欄に入る前に来た1本は反映待ちに残るが、タイマーが席の確定より先に起きると commit されず、
   * 張り直す者も居ない。探索が深いほど次の `info` は遅く、`検討中` のまま空のペインが残る。
   */
  schedule: () => void;
};

/**
 * `dispatch` へ結果を間引いて流す `ResultFlush` を返す。
 *
 * `analyzing` は解析中かどうかの ref。`state` の写しを渡すと、停止直後の無駄な更新を落とせる。
 *
 * **`holdsSeat` は描画を跨いで同じ関数を渡すこと。** 返す値は初回の描画で固定されるので、
 * 毎描画で作る述語を渡すと席の判定が初回の答えのまま残り、`検討中` のまま候補手が出なくなる。
 * tsc も lint も止めない。いまの呼び手は `EngineSeat` の `isHeld` を渡す。
 */
export function useResultFlush(
  dispatch: Dispatch<AnalysisAction>,
  analyzing: RefObject<boolean>,
  holdsSeat: () => boolean,
): ResultFlush {
  const latestRef = useRef<AnalysisResult | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitLatest = useCallback(() => {
    if (!analyzing.current) return;

    // 捨てた席の1本を反映待ちから落とす形だけでは、落とす前にタイマーが起きると守れない。
    // 死んだエンジンの読み筋が、盤が別の局面を映したまま残る。
    // 席が欄に入る前に届いた1本は残り、握った直後の `schedule` が出し直す。
    if (!holdsSeat()) return;

    const r = latestRef.current;
    if (!r) return;

    dispatch({ type: "update_result", payload: r });
  }, [dispatch, analyzing, holdsSeat]);

  const schedule = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitLatest();
    }, waits().resultFlushMs);
  }, [commitLatest]);

  const dropPending = useCallback(() => {
    clearTimer();
    latestRef.current = null;
  }, [clearTimer]);

  // 同じ物を返し続ける（理由は `useEngineSeat` の `apiRef`）。`useMemo` は値を捨てないことを
  // React が約束しないので、同一性を要求する値は ref で固定する。
  const apiRef = useRef<ResultFlush | null>(null);

  // ここから下は初回の描画でしか走らず、読んだ値は初回の値のまま残る。上に置いてよい形は
  // `src/entities/analysis/model/__tests__/seatSlotShape.ratchet.test.ts` が持つ。
  if (apiRef.current) return apiRef.current;

  apiRef.current = {
    receive: (result) => {
      latestRef.current = result;
      schedule();
    },
    dropPending,
    discardShown: () => {
      dropPending();
      dispatch({ type: "clear_results" });
    },
    schedule,
  };

  return apiRef.current;
}
