import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import {
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  type AnalysisSessionId,
} from "@/entities/engine/api/tauri";
import { useEngineSeat, type DiscardPoint, type SeatTakeResult } from "./useEngineSeat";
import { useResultFlush } from "./useResultFlush";
import { waits } from "./waits";
import { analysisReducer, initialState } from "./reducer";
import {
  useEngine,
  isRecoverableNotReady,
  type AnalysisResult,
  type EngineReadiness,
} from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "@/entities/engine/api/events";
import { AnalysisContext } from "./context";
import {
  ENGINE_ERROR_MESSAGE,
  WHILE_ANALYZING_REFUSALS,
  LISTENERS_FAILED_MESSAGE,
  ON_START_REFUSALS,
  POSITION_SYNC_FAILED_MESSAGE,
  POSITION_SYNC_TIMEOUT_MESSAGE,
  RELEASE_FAILED_MESSAGE,
  RESTART_FAILED_MESSAGE,
  START_REFUSED_MESSAGE,
  ENGINE_RESTARTED_MESSAGE,
  STOP_FAILED_MESSAGE,
} from "./refusals";

// 条件が満たされるまで待つ。**上限か `abort` で抜ける。**
//
// `abort` を取るのは、待っている理由が消えたときに回り続けないため。
// 畳まれた後は `syncedSfen` がもう動かないので、渡さないと必ず上限まで回る。
const waitUntil = async (cond: () => boolean, timeoutMs: number, abort?: () => boolean) => {
  const start = Date.now();
  while (!cond()) {
    if (abort?.()) return false;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, waits().syncPollMs));
  }
  return true;
};

interface Props {
  children: ReactNode;
  positionSync: PositionSyncAdapter;
}

/**
 * 解析の状態と、Rust の席の生死を持つ。
 *
 * **呼び手が守ること。**
 *
 * - **棋譜の有無で畳まれない位置に置くこと**（`RuntimeProviders`）。棋譜を閉じるたびに
 *   畳まれる位置に置くと、「読む局面が無くなったら止める」effect（→ ※14）は死に、
 *   席を指して返す機会が消える。代わりに飛ぶのは `sweepOnUnmount` の**席を指さない停止**で、
 *   そちらは Rust の席を**全部**空けるので、別の口が取った席まで巻き添えにする
 * - `positionSync` は**アプリ全体で1箇所だけがマウントした** `useEnginePositionSync`
 *   を渡すこと（同期の状態が二重になると、待つ相手が食い違う）
 *
 * 畳まれた回は席を指さずに撃つ（→ `docs/state-transitions/analysis.md` ※12）。
 */
export function AnalysisProvider({ children, positionSync }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  // Rust の席の生死。**識別子を書き換えられるのはこのフックの中だけ。**
  const seat = useEngineSeat();

  const readiness = useEngine();
  const { isReady, notReadyReason } = readiness;

  const { currentSfen, syncedSfen, syncPosition } = positionSync;

  const unlistenRef = useRef<UnlistenFn | null>(null);

  /** 結果の購読に失敗した。**張り直す口はマウント時の1回だけ**なので、以後 ▶ は断りを立て直して降りる */
  const listenersFailedRef = useRef(false);

  /**
   * `waitUntil` の中から読む。**await の向こう側でエンジンが消えたかを見る。**
   *
   * **合併のまま1本で持つ。** 2つの ref に割ると tsc の narrowing が消え、読む側が
   * `notReadyReason ?? "既定値"` を書くことになる。どの既定値を選んでも3つのうち2つでは
   * 嘘になる（→ `EngineNotReadyReason`）。
   */
  const readinessRef = useRef<EngineReadiness>(readiness);

  // **この4本（`readinessRef` / `syncedSfenRef` / `currentSfenRef` / `analyzingRef`）は
  // effect で更新する。** 描画中に代入するほうがこのリポジトリの多数派
  // （`entities/engine` の `desiredRuntimeRef` ほか）だが、ここは揃えない——
  // 読むのは `await` の継続とタイマー／イベントのコールバックで、どれも描画の外。
  // **commit された値であること**のほうが要る——描画中に代入すると、
  // commit されなかった描画の値を読ませることになる。
  const syncedSfenRef = useRef<string | null>(syncedSfen);

  // いま盤が見ている局面。**手動開始が待つ相手をここから読む。**
  // 押した瞬間の値に焼き付けると、待っている間に盤が動いたとき、
  // もう誰も見ていない局面の同期を上限いっぱい待って断りを積む。
  const currentSfenRef = useRef<string | null>(currentSfen);
  const analyzingRef = useRef(state.isAnalyzing);

  // 届いた結果の間引き。**反映待ちとタイマーの組はこのフックの中だけ。**
  const results = useResultFlush(dispatch, analyzingRef, seat.isHeld);

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

  useEffect(() => {
    readinessRef.current = readiness;
  }, [readiness]);

  /**
   * エンジンへ投げ済みの局面。**`null` は「もう一度投げてよい」の印**で、
   * 自動再開が落ちた回に戻す。`state.analyzedSfen` は画面が読む値で、こちらは
   * 再開を抑止する印——落ちた回だけ両者は食い違う。
   */
  const sentSfenRef = useRef<string | null>(null);
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

  /**
   * 再開のタイマーが張られているか。**欄を読む綴りをここ1つにする。**
   *
   * 発火した時点で `scheduleRestart` が欄を空けるので、ここが true を返すのは
   * まだ起きていないタイマーが在るときだけ。空け忘れると、この門は**もう発火した id**
   * を見て降りる——盤が追いついても再開が張られない。
   */
  const isRestartScheduled = useCallback(() => debounceTimerRef.current !== null, []);

  /**
   * 飛んでいる再開があるなら予約して `true`。**2本目を重ねないための門。**
   *
   * 予約は `swapSeatAndGo` の `finally` が拾う。**門を2箇所に書き下ろさない**
   * ——拾い忘れると、エンジンが2回続けて落ちた回に再開の引き金が消える。
   */
  const bookIfRestarting = useCallback(() => {
    if (!restartInFlightRef.current) return false;
    pendingAfterRef.current = true;
    return true;
  }, []);

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

  /**
   * 握れなかった席の**反映待ち**を捨てる。**席の門と2枚で守る。**
   *
   * 主の保証は `commitLatest` の席の門（`useResultFlush`）——枠を落とすだけだと、
   * 落とす前にタイマーが起きた回を守れない。ここが落とすのは、次に席を握るまで
   * 枠に残る**古い1本**と、下の窓（席の門が開いてしまう回）。
   *
   * **無条件に落とす。** 呼び手は握れなかった回だけで、そこへ来る道はどれも
   * 先に席を返し終えている（返せなければ `takeSeatAndGo` へ入らない）。
   * 握った回は**ここを通らず** `results.schedule()` が出し直すので、
   * 席が欄に入る前に届いた1本を消す心配も要らない。

   *
   * **席を見て降りる形にしない。** 捨てる停止が落ちると `shoot` の catch
   * （`keepOrForget`）が席を欄へ書き戻すので、席を見る形だと**書き戻された席を根拠に
   * 反映待ちを残す**——その後は `commitLatest` の席の門も開くので、捨てた席の読み筋が
   * そこから出る。書き戻しは `await stopAnalysisCore` の向こうなので必ずここより後だが、
   * 席を返さずに呼ぶ口を足せば順序は変わる。
   * 守っているのは `provider.test.tsx` の
   * 「捨てる停止が落ちて席が欄へ戻っても、その席の結果は出さない」。
   *
   * **`clear_results` は撃たない**——`error` も消すので、直前に立った断りが黙って消える。
   */
  const dropPendingForLostSeat = useCallback(() => {
    results.dropPending();
  }, [results]);

  /**
   * 席を取って `go` を出し、握るまで。**開始する2つの口（▶ と自動再開）が同じものを通る。**
   *
   * 書き下ろしを2つ持つと、門を1枚足したときに片方だけに入る。
   * 開始の失敗は**呼び手へ投げる**（断りの文言は
   * 口ごとに違う）。握れなかった回は理由を返す（`SeatTakeResult`）。
   *
   * **▶ の口は3値を書き分ける**——エンジンが消えた回と、利用者が降りた回では出す物が
   * 違う。**自動再開の口はどちらでも黙って降りる**（押した人が居ない）。捨てる側は
   * その理由を `async-result-ignored:` で書くこと
   * （`src/__tests__/asyncResultUse.test.ts` が要求する）。
   *
   * **呼ぶ前に要求の世代の門（`supersededSince`）を通すこと。** 本体の先頭で
   * `clear_results` が飛び、それは `error` も消すので（`reducer.ts`）、要らなくなった
   * 要求がここへ入ると直前に立った断りが黙って消える。
   */
  const takeSeatAndGo = useCallback(
    async (seq: number, want: string, discardBy: DiscardPoint): Promise<SeatTakeResult> => {
      // **入口でも readiness を見る。入口は2つある。**
      //
      // 下の札が守るのは「往復の**前**に読んだ世代」だけで、**世代が上がった後に
      // ここへ入る要求**は素通りする——`releaseHeld` の `await` を跨いだ自動再開がそれ。
      // ▶ の側は `sendAndAwaitSync` が守っているように見えるが、`waitUntil` は
      // `cond()` を先に見るので、盤とエンジンが同じ局面を指していれば**打ち切りも
      // readiness の見直しも1度も走らない**——`syncPosition()` の `await` の向こうで
      // 死んだ回は、ここだけが止めている。
      //
      // 通してしまうと、Rust はまだ畳んでいないので**もう無いエンジンの席**を握り、
      // `landed` は `"held"` を返す。**以後どの effect も拾えない**——席の欄を捨てる
      // effect は先頭の `if (isReady) return;` で降り、`isReady` はもう倒れないため。
      // 盤は候補手0本で「解析中」を回し続ける。
      //
      // **`discardShown()` より前に置く。** 後ろだと、自動再開が死んだエンジンに当たった回に
      // `clear_results` が立っている断りを消し、**代わりを何も立てずに黙って降りる**
      // （自動再開の口は3値のどれでも黙って降りる）。
      // **入れ替えても落ちるテストは無い**——順序を守っているのは人だけ。
      if (!readinessRef.current.isReady) {
        // **握れなかった回の後始末は1本に揃える。** ここを通さないと、
        // 「握れなかった回はどれも通る」と名乗っている下の doc が偽になる
        // （いま席は必ず null なので、振る舞いは変わらない）。
        dropPendingForLostSeat();
        return "engine-gone";
      }

      results.discardShown();

      // **開始を頼む前に札を取る。** 往復の間にエンジンが消えたかは、この札が見る。
      const take = seat.beginTake(discardBy);

      // **席を握れなかった回の出口は1本。** 席が返ってきて捨てる回と、Rust に断られる回で
      // 後始末が割れると、片方だけが反映待ちを落とし忘れる。
      // **`landed` を先に決めてから、握れなかった側をまとめて畳む。**
      let landed: SeatTakeResult;
      try {
        const sessionId = await startInfiniteAnalysisCore();
        landed = take.landed(sessionId, () => supersededSince(seq));
      } catch (e) {
        // **断られた回も同じ窓に居る。** 畳んでいる最中のエンジンへの開始は Rust が
        // `Err` で返すので（`bridge.rs`）、起こし直しの窓は席が返るより断られるほうが
        // 多い。ここで分けないと、同じ操作の結末が「起こし直しの案内」と
        // 「起こし直してください」に割れる——**後者は利用者がいま済ませた操作**。
        if (!take.engineChanged()) throw e;
        landed = "engine-gone";
      }

      if (landed !== "held") {
        dropPendingForLostSeat();
        return landed;
      }

      dispatch({ type: "start_analysis", payload: { sfen: want } });

      // **開始の応答より早く届いた `info` を、ここで出し直す**（理由は
      // `ResultFlush.schedule` の doc）。
      results.schedule();

      sentSfenRef.current = want;
      return "held";
    },
    [results, dropPendingForLostSeat, seat, supersededSince],
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
    seat.armForMount();

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
            results.receive(result);
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
            // 一致しない側に倒したときの損は、畳んだときに席を指さない停止が1本出るだけ。
            seat.closeFinished(sessionId);

            results.flushNow(result);
            dispatch({ type: "stop_analysis" });
          },
          // **この通知も届かない**（`engine-error` を emit する行が無い。`docs/state-transitions/analysis.md` の E9 / ※6）。
          onError: (error: string) => {
            // 上流の文をそのまま `state.error` に載せない（`swapSeatAndGo` の catch と同じ）。
            console.error("[ANALYSIS] engine reported an error", error);
            dispatch({ type: "set_error", payload: ENGINE_ERROR_MESSAGE });
          },
        });

        if (!alive) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
        // **同じインスタンスに setup → cleanup → setup が走った回（StrictMode）に
        // 印を戻す。** 戻さないと、1度の一時的な失敗が以後の ▶ を永久に断る
        // （購読は生きているのに「アプリを起動し直してください」が出続ける）。
        listenersFailedRef.current = false;
      } catch (e) {
        // 畳まれた／張り直された pass の失敗で、生きているインスタンスの印と
        // `state.error` を汚さない。
        if (!alive) return;

        // **張り直す口が無い。** この effect の依存は全部固定なのでマウント1回きりで、
        // 落ちると結果が二度と届かない——`isAnalyzing` は true のまま候補手が0で固まる。
        //
        // **印を残す。** 断りだけでは足りない——▶ を1回押すと `clear_results` が
        // `error` を消し（`reducer.ts`）、そのまま `go` が出る。以後は「解析中・候補手0・
        // 断りも無し」で、唯一の案内（起動し直し）が画面から消える。
        console.error("[ANALYSIS] Failed to setup listeners:", e);
        listenersFailedRef.current = true;
        dispatch({ type: "set_error", payload: LISTENERS_FAILED_MESSAGE });
      }
    };

    setup();

    return () => {
      alive = false;
      results.dropPending();
      safeUnlisten();
    };
  }, [safeUnlisten, results, seat]);

  const runRestartRef = useRef<(seq: number) => void>(() => {});

  // 再開のタイマーを張る口をここ1つにする。畳まれた後に張ると、それを止める
  // cleanup はもう走らない。非同期の再開が返ってきた後の張り直しは、まさにそこを通る。
  const scheduleRestart = useCallback(
    (seq: number, delayMs: number) => {
      if (unmountedRef.current) return;

      // **張る前に必ず消す。** 呼び手に手書きさせると、1箇所落としたときに消えなかった
      // タイマーが本体（`runRestartRef.current`）を余分に起こす——`finally` が張り直す
      // 0ms の分は最新の `seq` なので世代の門で落ちず、同じ局面へ2本並んで
      // `take_session` に断られる（利用者はボタンを1つも押していない）。
      clearDebounceTimer();

      debounceTimerRef.current = window.setTimeout(() => {
        // **発火で欄を空ける。** 空けないと「タイマーが張られているか」を見る門
        // （同期の追従）が、もう発火した id を見て降りる。`useResultFlush` の
        // 間引きのタイマーが同じ形をしている。
        debounceTimerRef.current = null;
        runRestartRef.current(seq);
      }, delayMs);
    },
    [clearDebounceTimer],
  );

  /**
   * エンジンが望みの局面に追いつくのを、刻みながら待つ。**追いつかなければ打ち切る。**
   *
   * 上限が無いと、同期が恒久的に失敗したときに「解析中」の表示のままタイマーだけが
   * 回り続け、利用者には何も起きていないのに正常に見える。
   *
   * **経過時間は待つ相手（`seq` と局面）ごと持つ。** 時刻だけを持つと、前回の待ちの
   * 経過を引き継いで、次の待ちを1ミリ秒も待たずに打ち切る。
   *
   * **上限と刻みは `waits()` を共有している**
   * ので、値を変えれば両方に効く。**二重化しているのは待ちの形のほう**——手動の ▶ は
   * `sendAndAwaitSync` が `waitUntil` で待って断りを立てて投げ、こちらはタイマーを
   * 張り直して打ち切りで席を返す。**打ち切りの条件を変えるときは両方を見ること。**
   */
  const keepWaitingForSync = useCallback(
    (seq: number, want: string) => {
      const prev = syncWaitRef.current;
      const startedAt =
        prev && prev.seq === seq && prev.want === want ? prev.startedAt : Date.now();
      syncWaitRef.current = { seq, want, startedAt };

      if (Date.now() - startedAt > waits().positionSyncTimeoutMs) {
        syncWaitRef.current = null;
        clearDebounceTimer();

        // 握っている席を返してから断りを出す。握っていなければ何も撃たない。
        // 落ちたときの結末は `useEngineSeat` の `shootQuietly` にある。
        seat.releaseHeldQuietly("sync-timeout");

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      scheduleRestart(seq, waits().syncPollMs);
    },
    [clearDebounceTimer, scheduleRestart, seat],
  );

  /**
   * 古い席を返して新しい席を取り直す。**同期が追いついた回だけが通る。**
   *
   * `seq` は要求の世代。**await から戻った時点でもう一度見る**——返却は本物の往復なので、
   * その間に利用者が止めたり畳まれたりする。
   *
   * **飛んでいる間に来た要求は `finally` が拾う**（`pendingAfterRef`）。返す Promise を
   * `restartInFlightRef` に載せるのは呼び手。
   */
  const swapSeatAndGo = useCallback(
    async (seq: number, want: string) => {
      try {
        await seat.releaseHeld("restart");

        // 停止の応答を待っている間に、畳まれたり止められたりしている。
        // ここで go を出すと、誰も見ていない探索が走り、それを止める者もいない。
        //
        // **画面に触るのは門の後ろ。** `clear_results` は `error` も消すので
        // （`reducer.ts`）、要らなくなった要求がここを通ると、直前に立った
        // 打ち切りの `error` が黙って消える（その `error` の読み手はまだ0 → #277）。
        if (supersededSince(seq)) return;

        // 自動再開はどの失敗でも黙って降りる。押した人が居ないうえ、エンジンが
        // 消えた回は戻れば同期の追従が張り直し、要求が死んだ回は利用者自身が
        // 降りている（→ `docs/state-transitions/analysis.md` の ※13）。
        await takeSeatAndGo(seq, want, "late-restart"); // async-result-ignored: 上のとおり黙って降りる
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
        sentSfenRef.current = null;
      } finally {
        restartInFlightRef.current = null;

        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;
          const latestSeq = restartSeqRef.current;
          scheduleRestart(latestSeq, 0);
        }
      }
    },
    [scheduleRestart, seat, supersededSince, takeSeatAndGo],
  );

  // 自動再開の本体。**`scheduleRestart` が張ったタイマーからだけ呼ばれる。**
  //
  // **描画のたびに差し替える。** タイマーが運ぶのは `seq` だけなので、最新の
  // `syncedSfen` / `isReady` を運ぶのはこの再代入だけ。`useCallback` に包むと、
  // 依存を書いた時点で本体が**その描画の値で凍り**、盤が追いついても再開が動かない。
  // effect の中へ移すと commit 後の1描画ぶん遅れる。
  //
  // 門を並べて、追いつくのを待つか（`keepWaitingForSync`）、席を取り直すか
  // （`swapSeatAndGo`）を選ぶだけ。
  //
  // `seq` は要求の世代。**タイマーが起きた時点で見る**（await の向こうは各段が見る）。
  runRestartRef.current = (seq: number) => {
    // **張った後に要らなくなった回はここへ来る。** 張る側（`scheduleRestart`）は
    // 張る時点しか見ていない。
    if (supersededSince(seq)) return;
    if (!analyzingRef.current) return;
    // **鏡から読む。** ここは前のコミットで張ったタイマーからも呼ばれるので、
    // 描画スコープの値を読むと、入口の門（commit された鏡を読む）と1コミットずれる
    // ——エンジンは生きているのに、門が古い false を見て自動再開が1本落ちる。
    if (!readinessRef.current.isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (sentSfenRef.current === want) return;

    if (syncedSfenRef.current !== want) {
      keepWaitingForSync(seq, want);
      return;
    }

    syncWaitRef.current = null;

    if (bookIfRestarting()) return;

    restartInFlightRef.current = swapSeatAndGo(seq, want);
  };

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;

    // **読ませたい局面は門より前に書く。** これは盤の現在位置そのもので、
    // 再開が要るかどうかとは別の事実。門の後ろに置くと、盤を1手進めてすぐ戻した回
    // （再開が飛んでいる最中）に**前の局面が「読ませたい」欄に取り残される**
    // ——飛んでいた再開が着いた先で `syncedSfen` が動き、盤と違う局面へ `go` を撃つか、
    // 追いつかない局面を上限まで待って嘘の断りを立てる。
    desiredSfenRef.current = currentSfen;

    // **門は `state` で書く。** ref で書くと、その ref が動いた回に effect が
    // 再実行されない——盤が戻ってきた局面を既に解析済みだと読んだまま、
    // **盤と読んでいる局面が食い違ったことに誰も気づかない**。
    if (state.analyzedSfen === currentSfen) return;

    const seq = ++restartSeqRef.current;

    scheduleRestart(seq, waits().restartDebounceMs);

    return () => {
      clearDebounceTimer();
    };
  }, [
    currentSfen,
    state.isAnalyzing,
    state.analyzedSfen,
    isReady,
    scheduleRestart,
    clearDebounceTimer,
  ]);

  // **エンジンが使えなくなったら、投げ済みの印と席の欄を捨てる。**
  //
  // 引き金は `isReady` の立ち下がり全部——起こし直し・初期化の失敗・起動の設定が
  // 組み立てられなくなった回（→ `EngineNotReadyReason`）。Rust はどの畳み方でも席を
  // 先に全部空けるので、こちらの欄に残るのはもう無い席。捨てないと、戻ってきたときに
  // 下の effect が「その局面は投げ済み」と読んで降り、**「解析中」の表示のまま数字が
  // 一切動かない**（席は死んだまま握られる）。
  //
  // **ここは `isAnalyzing` に触らない。** 戻ってくる回はそのまま張り直したいので、
  // 止めるかどうかは理由を見てから決める（→ 次の effect）。
  useEffect(() => {
    if (isReady) return;

    // **エンジンの世代も進む**（`onEngineGone` の中）。立ち下がりを1回見るだけでは
    // 足りない——飛んでいる開始がこの後に着地して、捨てたばかりの印を書き戻す
    // （席が返るのは往復の後）。
    sentSfenRef.current = null;
    clearDebounceTimer();
    seat.onEngineGone();
    // **鏡の更新とこれは必ず同じ commit で走る**——`readiness` の同一性は `isReady` に
    // 連動するので（`entities/engine` の `useMemo`）、`isReady` が倒れる回は鏡の effect も
    // 必ず動く。席を取る往復が着地したときの枝（`landed === "engine-gone"`）は
    // `await` の継続なので、両方が走り終えた後の値を読む。**順序ではなく同一 commit が要る。**
  }, [isReady, seat, clearDebounceTimer]);

  /**
   * 走っている解析を、利用者の操作なしに畳む。
   *
   * **順序で守っているのは1つ**——`clear_results` は `error` も消すので（`reducer.ts`）、
   * 断りはその後に撃つ。
   *
   * `supersedeRequests()` が要るのは**掃除のため**——張られた debounce のタイマーと
   * 予約（`pendingAfterRef`）と望みの局面を落とす。残すと、エンジンが戻った回に
   * **利用者が何も押していないのに**古い要求が再点火する。
   * （断りが消される筋は `takeSeatAndGo` の入口の門が塞いでいるので、
   * 世代を上げること自体には**落ちるテストが無い**。）
   *
   * `stop_analysis` は `set_error` が既に倒しているので値を動かさない。**撃つ口を
   * 揃えるために残している**（同期の打ち切りと自動再開の失敗も同じ対で撃つ）。
   *
   * **席は撃たない。** どの引き金でも Rust は畳む前に席を空けており、撃つと
   * 起こし直した先へ裸の `stop` が書かれる（→ `docs/state-transitions/analysis.md` の ※12）。
   * 欄を空けるのは上の effect。
   */
  const cutRunningAnalysis = useCallback(
    (refusal: string) => {
      supersedeRequests();
      results.discardShown();
      dispatch({ type: "set_error", payload: refusal });
      dispatch({ type: "stop_analysis" });
    },
    [results, supersedeRequests],
  );

  // **戻ってこない回は、そこで断つ。** 置いておくと「解析中」の丸とタイマーが回り続ける。
  // **戻るかどうかを決めるのは engine 側**（`isRecoverableNotReady`。判断の全体は
  // `docs/state-transitions/engine.md` の ※7）。
  useEffect(() => {
    if (isReady) return;
    if (!state.isAnalyzing) return;
    if (isRecoverableNotReady(notReadyReason)) return;

    cutRunningAnalysis(WHILE_ANALYZING_REFUSALS[notReadyReason]);
  }, [isReady, notReadyReason, state.isAnalyzing, cutRunningAnalysis]);

  // **同期が追いついた回と、エンジンが戻った回の入口。**
  //
  // 局面が変わった側の effect は `syncedSfen` を依存に持たないので、送信が遅れて
  // 追いついた回を拾えない（盤が動いていない回は `state.analyzedSfen === currentSfen` の
  // 門でも降りる）。エンジンが戻った回は、上の effect が投げ済みの印を捨てているのでここを通る。
  //
  // 最後の門は、**既に張られているタイマーと飛んでいる再開に2本目を重ねない**ため。
  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (sentSfenRef.current === want) return;

    // **飛んでいるなら捨てずに予約する。** 降りてしまうと、エンジンが2回続けて
    // 落ちた回に再開の引き金が消える——飛んでいる側は席を捨てて降りるので
    // 張り直す者が居ない。盤を動かすまで「解析中」の表示のまま数字が動かない。
    if (bookIfRestarting()) return;

    if (isRestartScheduled()) return;

    scheduleRestart(restartSeqRef.current, 0);
  }, [
    syncedSfen,
    state.isAnalyzing,
    isReady,
    scheduleRestart,
    bookIfRestarting,
    isRestartScheduled,
  ]);

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
    // `isAnalyzing` が false のまま席だけ残る（→ `docs/state-transitions/analysis.md` の ※7）。`state` の写しで
    // 決めると、その回にエンジンが閉じた棋譜を読み続ける。
    if (!state.isAnalyzing && !seat.isHeld()) return;

    seat.releaseHeldQuietly("no-position");
    dispatch({ type: "stop_analysis" });
    // **解析中に閉じた回は、この effect が2回走る。** ここの `dispatch` が
    // `isAnalyzing` を倒し、それが依存に載っているため。2本目は
    // `releaseHeldQuietly` が1本目の後ろに並び、**1本目が席を返せていれば撃たない**
    // （並んだ側は撃つ直前に席を読み直す）。撃つのは返せなかった回だけ。
    //
    // **停止が届かないまま「停止中」になっていた回は1回で終わる**（→ `docs/state-transitions/analysis.md` の ※7）。
    // `isAnalyzing` は既に false なので、この `dispatch` では値が動かない。
    // その回に席を返すのは、上の門を `seat.isHeld()` で開けた1本目。
  }, [currentSfen, state.isAnalyzing, seat, supersedeRequests]);

  const startInFlightRef = useRef<Promise<void> | null>(null);

  /**
   * 断りを立てて投げる。**断りを立てる回はどの段もここを通る**——立て方を段ごとに選ばせない。
   *
   * **断りを立てない `throw` が1つだけ在る**（読む局面が無い回。理由は
   * `refuseIfCannotStart` の中）。`AnalysisContextType` がその1つを契約に書いている。
   */
  const failStart = useCallback((message: string, e: unknown): never => {
    dispatch({ type: "set_error", payload: message });
    throw e;
  }, []);

  /**
   * ▶ が `go` を出せる状態か。**出せないなら断りを立てて投げる。**
   *
   * 断るのは、押しても結果が届かない／エンジンに届かないと分かっている回だけ。
   * どの門も**席に触る前**に通るので、断った回に Rust の状態は1ビットも動かない。
   */
  const refuseIfCannotStart = useCallback(() => {
    // **結果を受け取れない回は `go` を出さない。** 出しても候補手は永久に届かず、
    // Rust の席だけが埋まる。断りは押すたびに立て直す（消えても次の ▶ で戻る）。
    if (listenersFailedRef.current) {
      failStart(LISTENERS_FAILED_MESSAGE, new Error("Analysis event listeners are not registered"));
    }

    // ▶ は ready でなくても押せる（`AnalysisPaneHeader` は局面の有無しか見ない）ので、
    // ここは**いちばん踏まれる枝**。理由は engine 側が決める（`desiredRuntime` を
    // 見られるのはあちらだけ）。`isReady` が false なら理由は必ず在る（`EngineReadiness`）。
    if (!isReady) {
      failStart(ON_START_REFUSALS[notReadyReason], new Error("Engine not ready"));
    }

    // **ここは断りを立てない。** 局面が無いとき ▶ は `disabled`（`AnalysisPaneHeader` が
    // 同じ値を見る）なので、**この文が画面に出る操作が無い**。context を直に呼ぶ口が
    // 増えたときのために `throw` だけ残す。
    if (!currentSfen) throw new Error("No position available for analysis");
  }, [isReady, notReadyReason, currentSfen, failStart]);

  /**
   * 盤の局面をエンジンへ送り、追いつくのを待つ。**追いつかなければ断りを立てて投げる。**
   *
   * 要らなくなった要求（畳まれた／止められた／読む局面が無くなった）は、断りを立てずに
   * `false` を返す——その失敗を出しても、出す先の画面がもう無いか、利用者が既に降りている。
   *
   * **待つ相手は「いま盤が見ている局面」。** 押した瞬間の値を待つと、待っている間に盤が
   * 動いた回は条件が二度と真にならず、上限いっぱい回してから断りを積む（同期は新しい
   * 局面へ追いついている）。
   */
  const sendAndAwaitSync = useCallback(
    async (seq: number) => {
      // 送信そのものが落ちた回も断る。`syncPosition` は `set_position` の失敗を呼び手へ
      // 投げる（自動追従の口は飲むので、投げ先はここだけ）。捕まえずに抜けると
      // `error` が null のまま終わり、押し直しても同じところで落ちる。
      try {
        await syncPosition();
      } catch (e) {
        if (supersededSince(seq)) return false;
        failStart(POSITION_SYNC_FAILED_MESSAGE, e);
      }

      // 送れていないまま始めると、エンジンには別の局面が入ったまま候補手が返り、盤面と
      // 一致しないものが表示される。**要らなくなったら待つのをやめる**——待ち続けても
      // `syncedSfen` はもう動かないので、上限いっぱい回るだけになる。
      const synced = await waitUntil(
        () => currentSfenRef.current !== null && syncedSfenRef.current === currentSfenRef.current,
        waits().positionSyncTimeoutMs,
        () => supersededSince(seq) || !readinessRef.current.isReady,
      );
      if (!synced) {
        if (supersededSince(seq)) return false;

        // **エンジンが消えた回は、その理由で断る。** 待ち続けても追いつかないうえ、
        // 「同期が遅い」の案内（押し直し）はここでは効かない——押し直すと今度は
        // 起動待ちの断りが出る。上限まで待たせてから違う理由を告げないこと。
        const engine = readinessRef.current;
        if (!engine.isReady) {
          failStart(
            ON_START_REFUSALS[engine.notReadyReason],
            new Error("engine went away while syncing"),
          );
        }

        failStart(POSITION_SYNC_TIMEOUT_MESSAGE, new Error("position sync timed out"));
      }

      // **`go` を出す前にも見る。** 抜かすと、止めた後・畳まれた後に `go` を出してから
      // 返ってきた席を返す——誰も見ていない探索が1往復ぶん走る。
      return !supersededSince(seq);
    },
    [syncPosition, supersededSince, failStart],
  );

  /**
   * 飛んでいる自動再開の開始を待つ。**要らなくなっていたら `false`。**
   *
   * Rust は席を**取ってから** `go` を待つので（`bridge.rs` の
   * `start_infinite_analysis_impl`）、その往復の間に ▶ を押すと `take_session` に
   * 断られる——**数百ミリ秒待てば通る回に「エンジンを起こし直せ」と案内する**ことになる。
   * 席の欄は空なので、返却の枠を待つだけでは足りない（席を握っているのは
   * 飛んでいる開始の側）。
   */
  const awaitInFlightRestart = useCallback(
    async (seq: number) => {
      const restarting = restartInFlightRef.current;
      if (!restarting) return true;

      await restarting.catch(() => {});
      return !supersededSince(seq);
    },
    [supersededSince],
  );

  /**
   * 握っている席を、開始を頼む前に返す。**返せなければ断りを立てて投げる。**
   *
   * 停止が届かなかった回はこの形になり、`isAnalyzing` が false なので ■ は出ていない。
   * 返さずに開始を頼むと Rust に断られ続ける（→ #172）。握っていなければ
   * `releaseHeld` は何もしない。要らなくなっていたら `false`。
   */
  const releaseHeldBeforeStart = useCallback(
    async (seq: number) => {
      try {
        await seat.releaseHeld("start");
      } catch (e) {
        if (supersededSince(seq)) return false;
        failStart(RELEASE_FAILED_MESSAGE, e);
      }
      return !supersededSince(seq);
    },
    [seat, supersededSince, failStart],
  );

  /**
   * ▶ の本体。**降りる段を3つ並べ**（飛んでいる自動再開を待つ／握っている席を返す／
   * 局面を送って追いつくのを待つ）、そのあと席を取って `go` を出す。
   *
   * **3つの段は、要らなくなっていたら `false` を返して降りる。** 断りを立てるかどうかは
   * 段の側が決める（立てる段は `failStart` で投げる）。
   *
   * **席を取る段だけは3値を返す**（`SeatTakeResult`）。エンジンが消えた回と利用者が
   * 降りた回で出す物が違うので、**書き分けはここ**——段の中に押し込むと、断りの立て方が
   * 2通りになる。
   *
   * `seq` は押した時点の世代。**返却より前に読む**——`releaseHeld` は本物の往復を
   * 挟むので、その間に世代が上がる（棋譜を閉じた回）と、後で読むと上がった後の値を
   * 持ってしまい、以降の門が1枚も効かない。
   */
  const startInfiniteAnalysis = useCallback(async () => {
    if (state.isAnalyzing) return;
    refuseIfCannotStart();

    // この窓でボタンから動く口は無い（席が返るまでヘッダは ▶ のまま）。
    // 動くのは畳まれた回と、読む局面が無くなった回。
    const seq = restartSeqRef.current;

    if (!(await awaitInFlightRestart(seq))) return;
    if (!(await releaseHeldBeforeStart(seq))) return;
    if (!(await sendAndAwaitSync(seq))) return;

    // 待ち切った局面で始める。押した瞬間の局面とは違うことがある。
    const want = currentSfenRef.current;
    if (!want) return;

    // **`.catch()` を挟まない。** `await` の後ろに `.then` を1段足すと、
    // 席が返ってから `landed` が握るか捨てるかを決めるまでの微小タスクが1つ増える
    // ——開始の応答と unmount が同じバッチに入る窓（`provider.test.tsx`）で、
    // 畳まれた後に席を返す側が間に合わなくなる。
    let landed: SeatTakeResult = "superseded";
    try {
      landed = await takeSeatAndGo(seq, want, "late-start");
    } catch (e) {
      // 要らなくなった要求の失敗は誰にも見せない。
      if (supersededSince(seq)) return;
      failStart(START_REFUSED_MESSAGE, e);
    }
    // **エンジンが消えた回は断る。** 押した人がまだ画面の前に居るので、黙ると
    // `AnalysisPaneHeader` の catch にも入らず `console.error` すら出ない
    // ——停止中はペインが控えを出すので**押す前と1ドットも変わらない画面**が残る。
    // ただし**要求がまだ生きている回だけ**——棋譜を閉じた回・畳まれた回も
    // `landed` はエンジンを先に見るのでここへ来るが、出す先の画面がもう無い。
    //
    // **まだ戻っていない回は、その理由で断る**（`sendAndAwaitSync` と同じ判断）。
    // 「もう一度 ▶」と案内した先で起動待ちの断りが出ると、案内が1回空振りする。
    if (landed === "engine-gone" && !supersededSince(seq)) {
      const engine = readinessRef.current;
      const refusal = engine.isReady
        ? ENGINE_RESTARTED_MESSAGE
        : ON_START_REFUSALS[engine.notReadyReason];

      failStart(refusal, new Error("engine was restarted while taking a seat"));
    }
    if (landed !== "held") return;

    desiredSfenRef.current = want;
  }, [
    state.isAnalyzing,
    refuseIfCannotStart,
    awaitInFlightRestart,
    releaseHeldBeforeStart,
    sendAndAwaitSync,
    failStart,
    supersededSince,
    takeSeatAndGo,
  ]);

  // **押している間に押し直されても1本にする。** `isAnalyzing` が立つのは
  // 局面を送って席が返った後（上限は `positionSyncTimeoutMs`）で、その間ボタンは
  // ▶ のまま押せる。
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
    // **フックに撃たせるかどうかとは別の判断**をするときだけ——席と `isAnalyzing` の
    // どちらかが立っていれば後始末ごと走らせたい「読む局面が無くなった」回と、
    // `useResultFlush` に席の門を渡す口。
    try {
      await seat.releaseHeld("stop");
    } catch (e) {
      // **停止が落ちても表示は停止中になり、タイマーも 0 に戻る**ので、成功と1ドットも
      // 見分けが付かない。断らないと、エンジンが閉じた探索を回し続けていることに
      // 利用者は気づけない。
      dispatch({ type: "set_error", payload: STOP_FAILED_MESSAGE });
      throw e;
    } finally {
      dispatch({ type: "stop_analysis" });
      results.dropPending();
    }
  }, [results, seat, supersedeRequests]);

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
