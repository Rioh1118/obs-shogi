import { useCallback, useRef, type Dispatch, type RefObject } from "react";
import type { AnalysisResult } from "@/entities/engine";
import type { AnalysisAction } from "./types";
import { waits } from "./waits";

/**
 * 届いた解析結果を、間引いて画面へ流す。
 *
 * **`info` は数十 ms 間隔で届く**ので、来るたびに commit すると描画が追いつかない。
 * 反映待ちを1枠だけ持ち、タイマーが起きたときの最新を出す。
 *
 * **反映待ちと間引きのタイマーで1組。** 片方だけ落とすと、捨てたはずの結果が
 * 次のタイマーで画面に出る——**別の局面の評価値と読み筋が、いまの局面の解析結果として**。
 * その組を外から触らせないためにフックへ閉じてある。捨てる口は `dropPending` の1つで、
 * 席を握れなかった経路はどれもそこを通ること。
 */
export interface ResultFlush {
  /** 届いた結果を反映待ちに置き、間引きのタイマーを張る */
  receive: (result: AnalysisResult) => void;
  /**
   * 反映待ちを**今すぐ**commit して、タイマーを畳む。
   *
   * 探索が終わった通知の口。この後に `stop_analysis` を dispatch するので、
   * 間引きを待つと `analyzingRef` が倒れて最後の1本が黙って捨てられる。
   */
  flushNow: (result: AnalysisResult) => void;
  /**
   * 反映待ちの1本と、それが張った間引きのタイマーを**両方**落とす。
   * **画面に出ている候補手には触らない**（それは `discardShown`）。
   *
   * **これは掃除であって、門ではない。** 捨てた席の結果を画面に出さない保証は
   * `commitLatest` の席の門が持つ——枠を落とすだけだと、落とす前にタイマーが
   * 起きた回を守れない。
   */
  dropPending: () => void;
  /**
   * 画面に出ている候補手ごと捨てる。**`go` を出す前に、開始する口が必ず通る。**
   *
   * 通さないと `start_analysis` が `analyzedSfen` だけを差し替えるので
   * （`reducer.ts`）、**前の局面の評価値と読み筋が、新しい局面の解析結果として出る**
   * ——新しい席の最初の `info` が届くまで。`AnalysisPane` はその間に
   * 現在の局面の鍵でキャッシュへ焼き付けるので、停止中に戻るたび出続ける。
   *
   * **`clear_results` は `error` も消す**（`reducer.ts`）ので、
   * 要らなくなった要求が通らない位置——世代の門の後ろ——で呼ぶこと。
   */
  discardShown: () => void;
  /**
   * タイマーが張られていなければ張る（張られていれば何もしない）。
   * **席を握った直後に呼ぶ。**
   *
   * 席が欄に入る前に来た1本は反映待ちに入るが、commit は `isAnalyzing` と席を見るので、
   * そのタイマーが席の確定より先に起きると commit されず、タイマーの欄も空に戻っている
   * ——張り直す者が居ない。探索が深いほど次の `info` までは伸びるので、
   * **「解析中」のまま空のペインが残る**。
   */
  schedule: () => void;
}

/**
 * `analyzing` は**解析中かどうかの観測値**を持つ ref。
 *
 * `state` の写しを渡すこと——commit の後に effect が書くので、タイマーの中から読むと
 * 停止直後の無駄な更新を落とせる。
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
    // 解析中じゃないならUI更新しない（stop直後の無駄更新防止）
    if (!analyzing.current) return;

    // **席を握っていない間は出さない。** 捨てた席の1本を「枠から落とす」形で防ぐと、
    // 落とす前にタイマーが起きた回（着地が間引きの1周期より遅い回）を守れない
    // ——**死んだエンジンの読み筋が、盤が別の局面を映したまま「解析中」で残る**。
    // 席が欄に入る前に届いた1本は枠に残り、握った直後の `schedule` が出し直す。
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

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。
  // 描画のたびに別物を返すと、依存が毎回変わって cleanup が走る
  // ——畳まれてもいないのに後始末が撃たれる。
  //
  // **`useEngineSeat` と同じ形。** `useMemo` は React が値を捨てないことを約束しないので、
  // 同一性を要求として持つ口は ref で凍らせる。同じスライスに2通りの答えを置かない。
  const apiRef = useRef<ResultFlush | null>(null);

  // **ここから下は初回の描画でしか走らない。** 返す口は初回のクロージャで凍るので、
  // ここで読む値は**その1回の値のまま**。上に置いてよいのは `useRef` と、
  // 依存が全部安定な `useCallback` だけ
  // （`src/entities/analysis/model/__tests__/seatSlotShape.ratchet.test.ts` が見る）。
  if (apiRef.current) return apiRef.current;

  apiRef.current = {
    receive: (result) => {
      latestRef.current = result;
      schedule();
    },
    flushNow: (result) => {
      latestRef.current = result;
      clearTimer();
      // **席の門を通さない。** 呼び手（`onComplete`）は席を締めてからここへ来るので、
      // 掛けると探索が終わった最後の1本が消える。
      if (!analyzing.current) return;
      dispatch({ type: "update_result", payload: result });
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
