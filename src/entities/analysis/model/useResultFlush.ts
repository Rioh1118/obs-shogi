import { useCallback, useMemo, useRef, type Dispatch, type RefObject } from "react";
import type { AnalysisResult } from "@/entities/engine";
import type { AnalysisAction } from "./types";

/** 結果を画面へ反映する間引き。**80ms ごとに1回**（`info` は数十 ms 間隔で届く） */
const RESULT_FLUSH_MS = 80;

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
   * 反映待ちを捨てる。**画面に出ている候補手には触らない。**
   *
   * 席を握れなかった回に通る。捨てる側が落とすのはこれ以降の `info` だけで、
   * 席が欄に入る前に届いて反映待ちに入った1本と、それが張ったタイマーには触らない。
   * 捨てる経路は `stop_analysis` を dispatch しないので、そのタイマーは起きて commit される。
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
   * 反映待ちを持っているなら、タイマーを張り直す。**席を握った直後に呼ぶ。**
   *
   * 席が欄に入る前に来た1本は反映待ちに入るが、commit は `isAnalyzing` を見るので、
   * そのタイマーが `start_analysis` の commit より先に起きると黙って捨てられ、
   * タイマーの欄も空に戻っている——張り直す者が居ない。探索が深いほど次の `info` までは
   * 伸びるので、**「解析中」のまま空のペインが残る**。
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

    const r = latestRef.current;
    if (!r) return;

    dispatch({ type: "update_result", payload: r });
  }, [dispatch, analyzing]);

  const schedule = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitLatest();
    }, RESULT_FLUSH_MS);
  }, [commitLatest]);

  const dropPending = useCallback(() => {
    clearTimer();
    latestRef.current = null;
  }, [clearTimer]);

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。依存が全部
  // 安定（`dispatch` は `useReducer` の、`analyzing` は ref）なので、この `useMemo` は
  // 一度しか走らない。
  return useMemo(
    () => ({
      receive: (result: AnalysisResult) => {
        latestRef.current = result;
        schedule();
      },
      flushNow: (result: AnalysisResult) => {
        latestRef.current = result;
        clearTimer();
        commitLatest();
      },
      dropPending,
      discardShown: () => {
        dropPending();
        dispatch({ type: "clear_results" });
      },
      schedule,
    }),
    [dispatch, schedule, clearTimer, commitLatest, dropPending],
  );
}
