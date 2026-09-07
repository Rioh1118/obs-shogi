import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import {
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  type AnalysisSessionId,
  type DiscardPoint,
} from "@/entities/engine/api/tauri";
import { useEngineSeat } from "./useEngineSeat";
import { analysisReducer, initialState } from "./reducer";
import { useEngine, type AnalysisResult } from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "@/entities/engine/api/events";
import { AnalysisContext } from "./context";

// 条件が満たされるまで待つ。**上限か `abort` で抜ける。**
//
// `abort` を取るのは、待っている理由が消えたときに回り続けないため。
// 畳まれた後は `syncedSfen` がもう動かないので、渡さないと必ず上限まで回る。
const waitUntil = async (cond: () => boolean, timeoutMs: number, abort?: () => boolean) => {
  const start = Date.now();
  while (!cond()) {
    if (abort?.()) return false;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 16));
  }
  return true;
};

// **断りは枝ごとに割る。** 復帰の手が違うものを同じ1文にすると、読み手（→ #277）が
// 「もう一度押す」のか「エンジンを起こし直す」のかを選べない。
// どの文も**次に何をすればよいか**で終える（ADR-0004 の決定1）。
//
// 起こし直し方は1箇所に置いてある（`docs/state-transitions/engine.md` の ※5）。
const RESTART_ENGINE_HINT = "設定でエンジンのオプションを変えて保存すると起こし直せます。";
/** 上限まで待っても同期が追いつかない。**押し直しで直りうる。** */
const POSITION_SYNC_TIMEOUT_MESSAGE =
  "エンジンが局面を受け取るのに時間が掛かっています。もう一度 ▶ を押してください。";
/** 局面の送信そのものが落ちた。**押し直しても同じところで落ちる。** */
const POSITION_SYNC_FAILED_MESSAGE = `エンジンに局面を送れませんでした。${RESTART_ENGINE_HINT}`;
/**
 * 握っている席を返せなかった（→ ※7 / F-7）。
 *
 * **まず押し直し。** 停止の invoke が一時的に落ちただけの回は、もう一度 ▶ を押すと
 * 同じ席へ撃ち直して戻る（`provider.test.tsx` が固定している）。
 */
const RELEASE_FAILED_MESSAGE = `前の解析を止められませんでした。もう一度 ▶ を押してください。それでも始まらないときは、${RESTART_ENGINE_HINT}`;
/** Rust が開始を断った（席が残っている。→ ※11 / #172）。 */
const START_REFUSED_MESSAGE = `解析を開始できませんでした。${RESTART_ENGINE_HINT}`;
/** エンジンが ready でない（→ F-9）。**▶ は押せてしまう**（`AnalysisPaneHeader`）。 */
const ENGINE_NOT_READY_MESSAGE = "エンジンが起動していません。設定でエンジンを選んでください。";
/** 読む局面が無い（棋譜を開いていない）。 */
const NO_POSITION_MESSAGE = "解析する局面がありません。棋譜を開いてください。";
/** Rust がエラー通知を送ってきた（→ E9。いま `emit` する口は無い）。 */
const ENGINE_ERROR_MESSAGE = `エンジンがエラーを返しました。${RESTART_ENGINE_HINT}`;
/** 盤を動かした後の自動再開が落ちた。**▶ で始め直せる**ことがある。 */
const RESTART_FAILED_MESSAGE = `解析を再開できませんでした。▶ を押しても始まらないときは、${RESTART_ENGINE_HINT}`;

interface Props {
  children: ReactNode;
  positionSync: PositionSyncAdapter;
}

export function AnalysisProvider({ children, positionSync }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  // Rust の席の生死。**識別子を書き換えられるのはこのフックの中だけ。**
  const seat = useEngineSeat();

  const { isReady } = useEngine();

  const { currentSfen, syncedSfen, syncPosition } = positionSync;

  const unlistenRef = useRef<UnlistenFn | null>(null);

  const syncedSfenRef = useRef<string | null>(syncedSfen);

  // いま盤が見ている局面。**手動開始が待つ相手をここから読む。**
  // 押した瞬間の値に焼き付けると、待っている間に盤が動いたとき、
  // もう誰も見ていない局面の同期を上限いっぱい待って断りを積む。
  const currentSfenRef = useRef<string | null>(currentSfen);
  const analyzingRef = useRef(state.isAnalyzing);

  const latestResultRef = useRef<AnalysisResult | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const RESULT_FLUSH_MS = 80;

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushLatest = useCallback(() => {
    // 解析中じゃないならUI更新しない（stop直後の無駄更新防止）
    if (!analyzingRef.current) return;

    const r = latestResultRef.current;
    if (!r) return;

    dispatch({ type: "update_result", payload: r });
  }, []);

  /**
   * 反映待ちの下書きを捨てる。**`latestResultRef` と間引きのタイマーで1組**なので、
   * 片方だけ落とすと、捨てたはずの結果が次のタイマーで画面に出る。
   */
  const dropPendingResult = useCallback(() => {
    clearFlushTimer();
    latestResultRef.current = null;
  }, [clearFlushTimer]);

  /**
   * 画面に出ている候補手を捨てる。**`go` を出す前に、開始する口が必ず通る。**
   *
   * 通さないと `start_analysis` が `currentPosition` だけを差し替えるので
   * （`reducer.ts`）、**前の局面の評価値と読み筋が、新しい局面の解析結果として出る**
   * ——新しい席の最初の `info` が届くまで。`AnalysisPane` はその間に
   * 現在の局面の鍵でキャッシュへ焼き付けるので、停止中に戻るたび出続ける。
   *
   * **`clear_results` は `error` も消す**（`reducer.ts`）ので、
   * 要らなくなった要求が通らない位置——世代の門の後ろ——で呼ぶこと。
   */
  const discardShownResults = useCallback(() => {
    dropPendingResult();
    dispatch({ type: "clear_results" });
  }, [dropPendingResult]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushLatest();
    }, RESULT_FLUSH_MS);
  }, [flushLatest, RESULT_FLUSH_MS]);

  const safeUnlisten = useCallback(() => {
    const fn = unlistenRef.current;
    unlistenRef.current = null;
    if (!fn) return;

    try {
      fn();
    } catch (e) {
      console.debug("[ANALYSIS] unlisten failed (ignored)", e);
    }
  }, []);

  useEffect(() => {
    syncedSfenRef.current = syncedSfen;
  }, [syncedSfen]);

  useEffect(() => {
    currentSfenRef.current = currentSfen;
  }, [currentSfen]);

  useEffect(() => {
    analyzingRef.current = state.isAnalyzing;
  }, [state.isAnalyzing]);

  const lastAnalyzedSfenRef = useRef<string | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  // 自動再開の同期待ち。打ち切りの判定に使う。
  // 待っている対象（seq と局面）ごと持つ。時刻だけを持つと、前回の待ちの経過時間を
  // 引き継いで、次の待ちを1ミリ秒も待たずに打ち切ってしまう。
  const syncWaitRef = useRef<{
    seq: number;
    want: string;
    startedAt: number;
  } | null>(null);
  const pendingAfterRef = useRef(false);

  const RESTART_DEBOUNCE_MS = 100;

  // エンジンが position を受け付けるまで待つ上限。これを超えたら送信できていないと
  // 見なし、盤面と一致しない候補手を出さないために解析を始めない。
  // 根拠は実測ではないので、重い評価関数の初期化で足りなければ引き上げてよい。
  const POSITION_SYNC_TIMEOUT_MS = 2000;

  // **`window` を通さない。** ここはタイマーのコールバックからも、畳んだ後の
  // 後始末からも呼ばれる。テスト環境は畳んだ後に `window` を落とすので、
  // そこで参照すると**テストが1本も失敗していないのに実行そのものが落ちる**。
  // `clearTimeout` はブラウザにも Node にもある。
  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const unmountedRef = useRef(false);

  // 開始を頼んでから席が返るまでの間に、その要求が要らなくなっていないか。
  //
  // **3つの引き金を同じに扱う**——畳まれた、利用者が止めた（または次の要求が始まった）、
  // 読む局面が無くなった。どれも「返ってきた席の持ち主が居ない」で、
  // 返さなければ Rust に残る。
  // `stopAnalysis` は世代を上げるが、撃てるのはその時点で握っている席まで
  // ——後から返る席を返せるのは、応答が返った側だけ。
  const supersededSince = useCallback(
    (seq: number) => unmountedRef.current || restartSeqRef.current !== seq,
    [],
  );

  // 走っている要求を全部捨てる。**捨てるときの後始末をここにまとめる**
  // （世代・望みの局面・保留・タイマー）。利用者が止めた回と、読む局面が
  // 無くなった回が通る。散らすと、引き金を1つ足すたびにどれを写し忘れたかを
  // 人が数えることになる。
  //
  // **世代だけを上げる口はもう1つある**——局面が変わった回（下の effect）は
  // 次の要求を同時に立てるので、望みの局面を残したままここを通らない。
  // 畳まれた回は `unmountedRef` が同じ役をする。
  const supersedeRequests = useCallback(() => {
    desiredSfenRef.current = null;
    pendingAfterRef.current = false;
    restartSeqRef.current++;
    clearDebounceTimer();
  }, [clearDebounceTimer]);

  // 返ってきた席を握るか捨てるか。**欄に入れる前に見る**——要らなくなった席を
  // 欄に入れると、その後に入った別の席を上書きして、走っている方を知る者が居なくなる。
  // 捨てた側は `false` を返すので、呼び手はそこで打ち切る。
  const holdUnlessSuperseded = useCallback(
    (seq: number, by: DiscardPoint, sessionId: AnalysisSessionId) => {
      if (supersededSince(seq)) {
        seat.discard(by, sessionId);

        // **席と一緒に、その席の反映待ちも捨てる。** `discard` が落とすのは
        // これ以降の `info` だけで、席が欄に入る前に届いて `latestResultRef` に
        // 入った1本と、それが張ったタイマーには触らない。この経路は
        // `stop_analysis` を dispatch しないので、そのタイマーは起きて commit される
        // ——**別の局面の評価値と読み筋が、いまの局面の解析結果として画面に出る**
        // （盤がその局面に戻ると、ペインのキャッシュにも焼き付く）。
        //
        // **落とすのは席を握っていないときだけ。** 握っているなら、待っているのは
        // その席のもの（`accepts` が他を落とす）で、捨てた席とは関係が無い
        // ——落とすと、いま走っている探索の最初の `info` が消える。
        // `clear_results` は撃たない——`error` も消すので、直前に立った断りが黙って消える。
        if (!seat.isHeld()) dropPendingResult();
        return false;
      }
      seat.hold(sessionId);
      return true;
    },
    [seat, supersededSince, dropPendingResult],
  );

  // 畳まれたときに、この画面が残していくものを断つ。**2つある。**
  //
  // - 再開のタイマー。局面を見る effect の cleanup だけでは足りない——早期 return を
  //   踏んだ回は cleanup を登録しないので、その回に張られた分を止める者が残らない。
  //   残ると、居ない画面のためにエンジンへ go を出し、window の消えたテスト環境では
  //   タイマー自身が投げる
  // - Rust の席。→ `seat.sweepOnUnmount()`（`useEngineSeat.ts`）
  useEffect(() => {
    // **setup で戻す。** cleanup で落とすだけだと、同じインスタンスに
    // setup → cleanup → setup が走ったとき（StrictMode）に true のまま残り、
    // 以降タイマーが1つも張られず、盤を進めても解析が黙って再開しなくなる。
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      clearDebounceTimer();
      seat.sweepOnUnmount();
    };
    // `seat` は同じ物が返り続ける（`useEngineSeat`）。載せても再実行されない。
  }, [seat, clearDebounceTimer]);

  // === Event listeners ===
  useEffect(() => {
    let alive = true;

    const setup = async () => {
      safeUnlisten();

      if (!isTauri()) return;

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (sessionId: AnalysisSessionId, result: AnalysisResult) => {
            // **自分の席のものだけ採る**（判定と理由は `EngineSeat.accepts`）。
            if (!seat.accepts(sessionId)) return;
            latestResultRef.current = result;
            scheduleFlush();
          },
          // **この通知は現物では届かない。** `analysis-complete` を emit する行が
          // Rust に無い（`docs/state-transitions/analysis.md` の E8 / ※6）。
          // 口が入ったときの取り決めとして置いてある。
          onComplete: (sessionId: AnalysisSessionId, result: AnalysisResult) => {
            // **自分の席のものだけ採る**（`onUpdate` と同じ門）。通さないと、古い席の
            // 完了通知1本で走っている解析の表示が停止中に落ち、前の局面の評価値が出る。
            if (!seat.accepts(sessionId)) return;

            // 終わった探索の席は Rust が自分で片付ける（`bridge.rs` の
            // `forward_results_to_ui`）。**握っている席と一致するときだけ手放す。**
            // 一致しないまま手放すと、走っている別の席を知る者が居なくなる。
            // 一致しない側に倒したときの損は、畳んだときに空振りの停止が1本出るだけ。
            seat.closeFinished(sessionId);

            latestResultRef.current = result;
            clearFlushTimer();
            flushLatest();
            dispatch({ type: "stop_analysis" });
          },
          // **この通知も届かない**（`engine-error` を emit する行が無い。E9 / ※6）。
          onError: (error: string) => {
            // 上流の文をそのまま `state.error` に載せない（`runRestart` の catch と同じ）。
            console.error("[ANALYSIS] engine reported an error", error);
            dispatch({ type: "set_error", payload: ENGINE_ERROR_MESSAGE });
          },
        });

        if (!alive) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[ANALYSIS] Failed to setup listeners:", e);
      }
    };

    setup();

    return () => {
      alive = false;
      clearFlushTimer();
      safeUnlisten();
    };
  }, [safeUnlisten, scheduleFlush, clearFlushTimer, flushLatest, seat]);

  const runRestartRef = useRef<(seq: number) => void>(() => {});

  // 再開のタイマーを張る口をここ1つにする。畳まれた後に張ると、それを止める
  // cleanup はもう走らない。非同期の再開が返ってきた後の張り直しは、まさにそこを通る。
  const scheduleRestart = useCallback((seq: number, delayMs: number) => {
    if (unmountedRef.current) return;
    debounceTimerRef.current = window.setTimeout(() => {
      runRestartRef.current(seq);
    }, delayMs);
  }, []);

  // 自動再開の本体。**`scheduleRestart` が張ったタイマーからだけ呼ばれる。**
  //
  // やることは3つ。エンジンが望みの局面に追いつくのを待つ（追いつかなければ打ち切る）、
  // 古い席を返して新しい席を取る、その席が要らなくなっていないかを見る。
  //
  // `seq` は要求の世代。**タイマーが起きた時点と、await から戻った時点の両方で見る。**
  // 見ないと、利用者が止めた後や次の要求が始まった後に go を出す。
  runRestartRef.current = (seq: number) => {
    // **張った後に要らなくなった回はここへ来る。** 張る側（`scheduleRestart`）は
    // 張る時点しか見ていない。
    if (supersededSince(seq)) return;
    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (syncedSfen !== want) {
      // 同期を待つ。手動開始と同じ上限で打ち切る。上限が無いと、同期が恒久的に
      // 失敗したときに「解析中」の表示のままタイマーだけが回り続け、
      // 利用者には何も起きていないのに正常に見える。
      const prev = syncWaitRef.current;
      const startedAt =
        prev && prev.seq === seq && prev.want === want ? prev.startedAt : Date.now();
      syncWaitRef.current = { seq, want, startedAt };

      if (Date.now() - startedAt > POSITION_SYNC_TIMEOUT_MS) {
        syncWaitRef.current = null;
        clearDebounceTimer();

        // 握っている席を返してから断りを出す。握っていなければ何も撃たない。
        // 落ちたときの結末は `useEngineSeat` の `shootQuietly` にある。
        seat.releaseHeldQuietly("sync-timeout");

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      clearDebounceTimer();
      scheduleRestart(seq, 16);
      return;
    }

    syncWaitRef.current = null;

    if (restartInFlightRef.current) {
      pendingAfterRef.current = true;
      return;
    }

    restartInFlightRef.current = (async () => {
      try {
        await seat.releaseHeld("restart");

        // 停止の応答を待っている間に、畳まれたり止められたりしている。
        // ここで go を出すと、誰も見ていない探索が走り、それを止める者もいない。
        //
        // **画面に触るのは門の後ろ。** `clear_results` は `error` も消すので
        // （`reducer.ts`）、要らなくなった要求がここを通ると、直前に立った
        // 打ち切りの `error` が黙って消える（その `error` の読み手はまだ0 → #277）。
        if (supersededSince(seq)) return;

        discardShownResults();

        const newSessionId = await startInfiniteAnalysisCore();
        if (!holdUnlessSuperseded(seq, "late-restart", newSessionId)) return;

        dispatch({ type: "start_analysis", payload: { position: want } });

        // **開始の応答より早く届いた `info` を、ここで出し直す。** 席が欄に入る前に
        // 来た1本は `latestResultRef` に入るが、`flushLatest` は `isAnalyzing` を見るので
        // （`analyzingRef`）、そのタイマーが `start_analysis` の commit より先に起きると
        // 黙って捨てられ、タイマーの欄も空に戻っている——張り直す者が居ない。
        // 探索が深いほど次の `info` までは伸びるので、**「解析中」のまま空のペインが残る**。
        scheduleFlush();

        lastAnalyzedSfenRef.current = want;
      } catch (e) {
        // 要らなくなった要求の失敗は、誰にも見せない。利用者が止めた後に
        // 「再開に失敗しました」が出るし、`stop_analysis` の dispatch は
        // 別の理由で走り出した解析を巻き添えにする。
        if (supersededSince(seq)) return;

        // **上流の文をそのまま載せない。** ここに入る `e` は Rust の英文
        // （`take_session` の断りなど）で、`state.error` は画面へ出す欄
        // （読み手はまだ0 → #277）。中身は `console.error` にだけ残す。
        console.error("[ANALYSIS] restart failed", e);
        dispatch({ type: "set_error", payload: RESTART_FAILED_MESSAGE });
        dispatch({ type: "stop_analysis" });
        lastAnalyzedSfenRef.current = null;
      } finally {
        restartInFlightRef.current = null;

        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;
          const latestSeq = restartSeqRef.current;
          clearDebounceTimer();
          scheduleRestart(latestSeq, 0);
        }
      }
    })();
  };

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;
    if (lastAnalyzedSfenRef.current === currentSfen) return;

    desiredSfenRef.current = currentSfen;

    clearDebounceTimer();
    const seq = ++restartSeqRef.current;

    scheduleRestart(seq, RESTART_DEBOUNCE_MS);

    return () => {
      clearDebounceTimer();
    };
  }, [currentSfen, state.isAnalyzing, isReady, scheduleRestart, clearDebounceTimer]);

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (!debounceTimerRef.current && !restartInFlightRef.current) {
      scheduleRestart(restartSeqRef.current, 0);
    }
  }, [syncedSfen, state.isAnalyzing, isReady, scheduleRestart]);

  // **読む局面が無くなったら止める。** 棋譜を閉じると `currentSfen` が null になる。
  // `AnalysisProvider` は畳まれない（`RuntimeProviders` 側に居る）が、
  // `AnalysisPane` は消える（`AppLayout` の `hasKifu` の内側）ので ▶ も ■ も無くなる。
  // 自動再開は `if (!currentSfen) return` で黙って止まるだけなので、放っておくと
  // エンジンは閉じた棋譜の局面を読み続け、**それを止めるボタンは画面から消えている**。
  useEffect(() => {
    if (currentSfen) return;

    // **世代は先に上げる。** 飛んでいる開始（席が返るまで `isAnalyzing` は false）を
    // 打ち切るのはこの1行で、下の門より後ろに置くと、閉じた棋譜のために
    // 同期待ちが上限まで回り、閉じた局面で「解析中」が1回 commit される。
    supersedeRequests();

    // **席を握っていれば、表示が停止中でも返す。** 停止が届かなかった回は
    // `isAnalyzing` が false のまま席だけ残る（→ ※7）。`state` の写しで
    // 決めると、その回にエンジンが閉じた棋譜を読み続ける。
    if (!state.isAnalyzing && !seat.isHeld()) return;

    seat.releaseHeldQuietly("no-position");
    dispatch({ type: "stop_analysis" });
    // **解析中に閉じた回は、この effect が2回走る。** ここの `dispatch` が
    // `isAnalyzing` を倒し、それが依存に載っているため。2本目は
    // `releaseHeldQuietly` が1本目の後ろに並び、**1本目が席を返せていれば撃たない**
    // （並んだ側は撃つ直前に席を読み直す）。撃つのは返せなかった回だけ。
    //
    // **停止が届かないまま「停止中」になっていた回は1回で終わる**（→ ※7）。
    // `isAnalyzing` は既に false なので、この `dispatch` では値が動かない。
    // その回に席を返すのは、上の門を `seat.isHeld()` で開けた1本目。
  }, [currentSfen, state.isAnalyzing, seat, supersedeRequests]);

  const startInFlightRef = useRef<Promise<void> | null>(null);

  /**
   * ▶ の本体。**やることは5つ**——握っている席を返す、局面を送る、エンジンが
   * 追いつくのを待つ、要らなくなっていないかを見る、開始して席を握る。
   *
   * `seq` は押した時点の世代。**返却より前に読む**——`releaseHeld` は本物の往復を
   * 挟むので、その間に世代が上がる（棋譜を閉じた回）と、後で読むと上がった後の値を
   * 持ってしまい、以降の門が1枚も効かない。
   *
   * 失敗する `await` は3つ（返す・送る・始める）。**どれも同じ形で包む**——
   * 世代の門を通してから `set_error` を立て、呼び手へ投げ直す。
   */
  const startInfiniteAnalysis = useCallback(async () => {
    // **前置きの門も断りを立てる。** ▶ は ready でなくても押せる
    // （`AnalysisPaneHeader` は局面の有無しか見ない）ので、ここは**いちばん踏まれる枝**。
    // 立てないと `console.error` で終わり、#277 が出口を作っても無言のまま残る。
    if (!isReady) {
      dispatch({ type: "set_error", payload: ENGINE_NOT_READY_MESSAGE });
      throw new Error("Engine not ready");
    }
    if (state.isAnalyzing) return;
    if (!currentSfen) {
      dispatch({ type: "set_error", payload: NO_POSITION_MESSAGE });
      throw new Error("No position available for analysis");
    }

    // **席を握ったままなら先に返す。** 停止が届かなかった回はこの形になり、
    // `isAnalyzing` が false なので ■ は出ていない。返さずに開始を頼むと
    // Rust に断られ続け、画面からは復帰できなくなる（→ #172）。
    // 押してから席が返るまでの世代。**返却より前に読む**——`releaseHeld` は
    // 本物の往復を挟むので、その間に世代が上がる（棋譜を閉じた回）と、
    // 後で読むと上がった後の値を持ってしまい、以降の門が1枚も効かない。
    //
    // この窓でボタンから動く口は無い（席が返るまでヘッダは ▶ のまま）。
    // 動くのは畳まれた回と、読む局面が無くなった回。
    const seq = restartSeqRef.current;

    // **失敗する `await` は3つとも同じ形で包む**（返す・送る・始める）。
    // 包まないと、その枝だけ `error` が null のまま `console.error` で終わり、
    // #277 が出口を作っても永久に出ない。要らなくなった要求の失敗は誰にも見せない。
    const failStart = (message: string, e: unknown): never => {
      dispatch({ type: "set_error", payload: message });
      throw e;
    };

    // **飛んでいる自動再開の開始を待つ。** Rust は席を**取ってから** `go` を待つので
    // （`bridge.rs` の `start_infinite_analysis_impl`）、その往復の間に ▶ を押すと
    // `take_session` に断られる——**数百ミリ秒待てば通る回に「エンジンを起こし直せ」と
    // 案内する**ことになる。席の欄は空なので、返却の枠を待つだけでは足りない
    // （席を握っているのは飛んでいる開始の側）。
    const restarting = restartInFlightRef.current;
    if (restarting) {
      await restarting.catch(() => {});
      if (supersededSince(seq)) return;
    }

    // 握っていなければ `releaseHeld` は何もしない。
    try {
      await seat.releaseHeld("start");
    } catch (e) {
      if (supersededSince(seq)) return;
      failStart(RELEASE_FAILED_MESSAGE, e);
    }
    if (supersededSince(seq)) return;

    // **送信そのものが落ちた回も断りを立てる。** `syncPosition` は
    // `set_position` の失敗を呼び手へ投げる（自動追従の口は飲むので、
    // 投げ先はここだけ）。捕まえずに抜けると `error` が null のまま
    // `AnalysisPaneHeader` の `console.error` で終わり、**画面は停止中のまま
    // 1ドットも変わらない**——押し直しても同じところで落ちる。
    // 打ち切りの回（下）と違って `error` にすら載らないので、#277 が出口を
    // 作っても永久に出ない。
    try {
      await syncPosition();
    } catch (e) {
      if (supersededSince(seq)) return;
      failStart(POSITION_SYNC_FAILED_MESSAGE, e);
    }

    // 送れていないまま解析を始めると、エンジンには別の局面が入ったまま
    // 候補手が返ってきて、盤面と一致しないものが表示される。
    //
    // **待つ相手は「いま盤が見ている局面」。** 押した瞬間の値を待つと、
    // 待っている間に盤が動いた回は条件が二度と真にならず、上限いっぱい回してから
    // 何も失敗していないのに断りを積む（同期は新しい局面へ追いついている）。
    //
    // **要らなくなったら待つのをやめる**（畳まれた／止められた／読む局面が無くなった）。
    // 待ち続けても `syncedSfen` はもう動かないので、上限いっぱい回るだけになる。
    const synced = await waitUntil(
      () => currentSfenRef.current !== null && syncedSfenRef.current === currentSfenRef.current,
      POSITION_SYNC_TIMEOUT_MS,
      () => supersededSince(seq),
    );
    if (!synced) {
      // 要らなくなった要求の失敗は誰にも見せない（再開側の `catch` と同じ）。
      if (supersededSince(seq)) return;

      dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
      throw new Error(POSITION_SYNC_TIMEOUT_MESSAGE);
    }

    // **go を出す前にも見る。** 再開側と同じ形（`runRestartRef` の中）。
    // ここを抜かすと、止めた後・畳まれた後にエンジンへ `go` を出してから、
    // 返ってきた席を返す——誰も見ていない探索が1往復ぶん走る。
    if (supersededSince(seq)) return;

    // 待ち切った局面で始める。押した瞬間の局面とは違うことがある。
    const started = currentSfenRef.current;
    if (!started) return;

    discardShownResults();

    // **`.catch()` を挟まない。** `await` の後ろに `.then` を1段足すと、
    // 席が返ってから `hold` / `discard` に着くまでの微小タスクが1つ増える
    // ——開始の応答と unmount が同じバッチに入る窓（`provider.test.tsx`）で、
    // 畳まれた後に席を返す側が間に合わなくなる。
    let sessionId: AnalysisSessionId | null = null;
    try {
      sessionId = await startInfiniteAnalysisCore();
    } catch (e) {
      // 要らなくなった要求の失敗は誰にも見せない。
      if (supersededSince(seq)) return;
      failStart(START_REFUSED_MESSAGE, e);
    }
    if (sessionId === null) return;

    if (!holdUnlessSuperseded(seq, "late-start", sessionId)) return;

    dispatch({ type: "start_analysis", payload: { position: started } });

    // 理由は自動再開の側に1つ置いてある（`runRestart` の同じ行）。
    scheduleFlush();

    lastAnalyzedSfenRef.current = started;
    desiredSfenRef.current = started;
  }, [
    isReady,
    state.isAnalyzing,
    currentSfen,
    syncPosition,
    seat,
    supersededSince,
    holdUnlessSuperseded,
    discardShownResults,
    scheduleFlush,
  ]);

  // **押している間に押し直されても1本にする。** `isAnalyzing` が立つのは
  // 局面を送って席が返った後（最大2秒）で、その間ボタンは ▶ のまま押せる。
  // 2本目は Rust の `take_session` に断られ、その断りは `console.error` で終わる
  // ——利用者には何も出ない。
  //
  // **`finally` で必ず外す。** 外し忘れると、以降 ▶ が「走っている」と
  // 見なされて二度と始まらない。
  const startInfiniteAnalysisOnce = useCallback(async () => {
    const running = startInFlightRef.current;
    if (running) return running;

    const started = startInfiniteAnalysis().finally(() => {
      startInFlightRef.current = null;
    });
    startInFlightRef.current = started;
    return started;
  }, [startInfiniteAnalysis]);

  const stopAnalysis = useCallback(async () => {
    // **世代は返却より先に上げる。** 上げないと、飛んでいる開始が返ってきた席を
    // 古い世代のまま握り、止めたのに Rust で走り続ける（理由の本文は
    // 「読む局面が無くなったら止める」effect の同じ行）。
    supersedeRequests();

    // **撃つかどうかの判定はフックの中。** 呼び手が `isHeld()` を見るのは、
    // 席と `isAnalyzing` のどちらかが立っていれば後始末ごと走らせたい
    // 「読む局面が無くなった」回の1箇所だけ。
    try {
      await seat.releaseHeld("stop");
    } finally {
      dispatch({ type: "stop_analysis" });
      dropPendingResult();
    }
  }, [dropPendingResult, seat, supersedeRequests]);

  const value = useMemo<AnalysisContextType>(
    () => ({
      state,
      startInfiniteAnalysis: startInfiniteAnalysisOnce,
      stopAnalysis,
    }),
    [state, startInfiniteAnalysisOnce, stopAnalysis],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
