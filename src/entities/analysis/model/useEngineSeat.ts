import { useRef } from "react";
import {
  stopAnalysis as stopAnalysisCore,
  type AnalysisSessionId,
  type BlockingReleasePoint,
  type DiscardReleasePoint,
  type QuietReleasePoint,
  type SeatReleasePoint,
  type StopOutcome,
} from "../api/tauri";

/**
 * 返ってきた席の扱い。
 *
 * `finished` は開始の応答より先に探索の完了が届いた席で、もう Rust に無いので握らない。
 * ▶ の経路は値を書き分け、自動再開の経路はどの値でも黙って降りる。
 * `Promise` で受ける値を読まずに捨てるなら理由を書く（`src/__tests__/asyncResultUse.test.ts`）。
 * 同期で返す `receiveSeat` の戻り値は検査の外で、人が見る。
 */
export type SeatTakeResult = "held" | "finished" | "engine-gone" | "superseded";

/**
 * 席を取る往復の、行きと帰りを結ぶ値。`beginTake` が作る
 *
 * 往復を跨いで、その席がどのエンジンのものかを判定する。世代を呼び手に持たせると、
 * 席を取る経路を足すたびに世代の判定を通したかを目で数えることになる。
 */
type SeatTake = {
  /**
   * Rust が渡した席を、握るか捨てるかを決める。
   *
   * エンジンを先に見る。往復の間に消えていたら、要求が生きていてもその席は死んでいる。
   * 消えていたら停止を送らずに捨てる。送ると起動し直したエンジンへ裸の `stop` が書かれる
   * （`docs/state-transitions/analysis.md` の ※12）。要らなくなっただけなら停止を送って捨てる。
   */
  receiveSeat: (sessionId: AnalysisSessionId, isSuperseded: () => boolean) => SeatTakeResult;
  /**
   * 開始が断られたときに、往復の間にエンジンが消えていたかを返す。
   *
   * 起動し直している最中のエンジンへの開始は Rust が `Err` で返す（`bridge.rs`）ので、席が返る場合と
   * 断られる場合の両方が同じ窓に入る。この述語で断りの文を1つに揃える。
   */
  hasEngineChanged: () => boolean;
};

/**
 * Rust が渡した解析の席（`active_sessions` の1エントリ）の生死を持つ面。
 *
 * 席の識別子とエンジンの世代はこのフックの中でだけ書き換える。席の生死は欄が埋まっているかと
 * その席のエンジンがまだ居るかの両方で決まり、片方を外に置くと判定が2つのモジュールに割れる。
 *
 * 席の在処を `state` から導かない。理由と、どの失敗で席が Rust に残るかは
 * `docs/state-transitions/analysis.md` の ※12 に置く。
 */
type EngineSeat = {
  /** 席を握っているか */
  isHeld: () => boolean;
  /**
   * エンジンの世代。往復の前に読み、失敗を報告する前に見直す。
   * 起動し直すと進むので、前のエンジンへの失敗で新しいエンジンを `応答なし` にせずに済む
   */
  engineGeneration: () => number;
  /**
   * 届いた通知を採ってよいかを返す。
   *
   * 手放した席は握り直していても落とす。停止が落ちると捨てると決めた席を握り直すので、
   * 席の照合を先にすると通ってしまう。
   * 残りは、握っていれば厳密に一致するときだけ、握っていなければ全部通す。席が欄に入るのは
   * 開始の応答の後で、それより早く届く `info` を落とさないため。
   */
  accepts: (sessionId: AnalysisSessionId) => boolean;
  /**
   * 席を取る往復を始め、席が返ったときに使う `SeatTake` を返す。
   *
   * **開始を頼む行より前で呼ぶこと。** 返す値には呼んだ時点のエンジンの世代が入るので、
   * 後で呼ぶと往復の間に消えたエンジンをまだ居ると読む。
   *
   * `engineUsable` はいまエンジンが使えるかの述語で、世代だけでは足りないために取る。
   * 席を返す往復の最中に起動し直されると、進んだ後の世代が入り、世代差は0のまま
   * その席は死んだエンジンのものになる。
   */
  beginTake: (discardBy: DiscardReleasePoint, engineUsable: () => boolean) => SeatTake;
  /**
   * Rust が片付けた席を締め、手放した席として覚える。
   *
   * 別の席を握っているときは、走っている席を巻き添えにしないよう何もしない。
   * 何も握っていなくても覚える。開始の応答より先に完了が届いたとき、`receiveSeat` がこの記録を見て
   * 握らずに済む。
   *
   * `keepOrForget` の書き戻しはこの記録を見ない。いま握り直しが起きないのは、締めた席へ
   * 停止を送る経路が無いため。そうした経路を足すなら、握り直してよいかを別に確かめること。
   */
  closeFinished: (sessionId: AnalysisSessionId) => void;
  /**
   * エンジンごと席が消えたときに、欄を空けて世代を進める。停止は送らない。
   *
   * 落とす側は席を全部空けてから落とし（`bridge.rs` の `shutdown_engine_impl`）、勝手に落ちたときは
   * `forward_results_to_ui` が席を消す。ここで送ると、席が空でも Rust は `analyzer.stop_analysis()` まで
   * 進み、起動し直したエンジンへ裸の `stop` が書かれる。
   *
   * 世代を進めるのはここだけ。応答待ちの往復（`SeatTake` と `sendStop`）はこの世代を見て、
   * もう無いエンジンの席を握らずに捨てる。
   */
  onEngineGone: () => void;
  /**
   * 握っている席を返す。返せたときだけ手放し、失敗は呼び手へ投げて席は握ったままにする。
   *
   * 応答待ちの返却があれば、握っていなくても `releasingRef` が空くまで待つ。待ち切って席が
   * 無ければ送らない。
   *
   * **`unanswered` なら次の開始を頼まないこと。** 席は空いたがエンジンは探索を終えておらず、
   * Rust が断って断りの文が立つ。
   */
  releaseHeld: (by: BlockingReleasePoint) => Promise<StopOutcome>;
  /** 応答を待てない場所から、握っている席を返す。握っていなければ何もしない。 */
  releaseHeldQuietly: (by: QuietReleasePoint) => void;
  /**
   * アンマウントの印を戻す。停止は送らない。
   *
   * cleanup で立てる印は setup で戻す。戻さないと StrictMode の setup → cleanup → setup で
   * 印が残り、画面が生きているのに席を指さない停止が飛ぶ。
   */
  markMounted: () => void;
  /**
   * アンマウント時に、席を指さない停止を送る。席を握っていなければ送らない。
   *
   * この停止が落ちると誰も返せない。席の識別子を持たないので `keepOrForget` の書き戻しに乗らない。
   */
  sweepOnUnmount: () => void;
};

/**
 * 手放した席を覚えておく本数。
 *
 * 遅れた `info` が届くのは席を手放してから停止が Rust に届くまでで、その間に重なる席は
 * たかだか数本（自動再開は1本ずつ直列に走る）。桁1つぶん余裕を取ってこの値。
 */
const RELEASED_SEAT_LIMIT = 32;

export function useEngineSeat(): EngineSeat {
  const seatRef = useRef<AnalysisSessionId | null>(null);

  /**
   * エンジンの世代。`onEngineGone` でだけ進む。
   *
   * 往復を跨いで、その席がどのエンジンのものかを判定する。進んだ後に返った席を握ると、
   * `検討中` のまま数字が動かなくなる。
   */
  const engineGenRef = useRef(0);

  /**
   * 手放した席の集合。`accepts` がこの席の通知を落とす。
   *
   * 入るのは、返し終えた席、完了通知で片付いた席、捨てると決めた席。
   * 1本だけ持つと、続けて2つ手放したときに古い方の遅れた `info` が通る。
   * 握り直しても消さない。消すと、盤を1手ずつ動かす経路（返す→握る→返す）で1本と同じになる。
   * 上限で切るのは、`AnalysisProvider` は普通アンマウントされず、解析を繰り返すぶんだけ育つため。
   *
   * Rust に無い席は別に持たない。`sendStop` に渡る識別子は握っている席か `discard` が受けた新しい
   * UUID（`bridge.rs` の `new_session_id`）だけで、返し終えた席で停止が落ちる経路が無い。
   * Rust に無い席を握ってしまうことはあるが区別できない。`stop_session` は席を消してから
   * エンジンを止めるので、エンジン側の失敗は「席は空で `Err`」で返る。
   */
  const releasedRef = useRef<Set<string>>(new Set());

  // 応答待ちの返却。引き金が重なったときに同じ席へ2本目を送らないために持つ。
  // 重ねても Rust は断らないが、順序も結末も保証できない。経路ごとの振る舞いは次のとおり。
  //
  // - `releaseHeld`: 自分の番まで待ってから席を見直す
  // - `releaseHeldQuietly`、`sweepOnUnmount`: 後ろに並び、席がまだ握られていれば送る
  // - `discard`: 並ばずに送り、前の返却とこの停止の両方を載せる（`foldIntoSlot`）。
  //   待っている `releaseHeld` は両方を待つ。捨てる席が Rust から消えるまで次の開始は始められない
  const releasingRef = useRef<Promise<void> | null>(null);

  /**
   * アンマウント済みか。書き戻された席を返し直す判断に使う。
   *
   * `sweepOnUnmount` が読むのは `releasingRef` が空いた時点の席で、席はその後に戻ることがある
   * （アンマウント後に返った席を捨て、その停止が落ちたとき）。戻す側の `keepOrForget` がこの印を見て
   * 送り直す。戻すのは `markMounted`。
   */
  const unmountedRef = useRef(false);

  // 呼び手はこの値を effect の依存に載せるので、同じ物を返し続ける。
  // 別物を返すと依存が毎回変わって cleanup が走り、アンマウントしていないのに席を返す。
  const apiRef = useRef<EngineSeat | null>(null);

  // ここから下は初回の描画でしか走らず、読んだ値は初回の値のまま残る。描画ごとに変わる値を
  // 読んでも tsc と lint は止めない。上に置いてよい形は
  // `src/entities/analysis/model/__tests__/seatSlotShape.ratchet.test.ts` が持つ。
  if (apiRef.current) return apiRef.current;

  const markReleased = (sessionId: AnalysisSessionId) => {
    // 入れ直して最後尾へ。`Set` は挿入順を保つので、先頭が最も古い
    releasedRef.current.delete(sessionId);
    releasedRef.current.add(sessionId);
    while (releasedRef.current.size > RELEASED_SEAT_LIMIT) {
      const oldest = releasedRef.current.values().next();
      if (oldest.done) break;
      releasedRef.current.delete(oldest.value);
    }
  };

  /**
   * 停止が落ちた席を、欄へ書き戻すか、手放した席として覚える。
   *
   * 欄が空なら書き戻す。要らなくなった開始を捨てる経路は欄が空のまま送るので、書き戻さないと
   * `sweepOnUnmount` が席の判定で止まり、返す機会が無くなる。
   * 欄が埋まっていれば別の席なので触らない。そのとき送った席は誰も知らないまま Rust に残りうる
   * （`analysis.md` の ※12）。開始する経路は `releasingRef` を待ち切るのでいまは起きない。
   * `discard` の呼び手を増やすなら見直すこと。
   *
   * 往復の間にエンジンが消えていたら書き戻さない。その席は Rust に無く、欄へ戻すと以後の停止が
   * 次のエンジンへその識別子で飛ぶ。
   *
   * アンマウント後に書き戻したら、席を指さない停止をそのまま1本送る。
   */
  const keepOrForget = (sessionId: AnalysisSessionId | undefined, generation: number) => {
    if (sessionId === undefined || seatRef.current !== null) return;

    if (engineGenRef.current !== generation) {
      markReleased(sessionId);
      return;
    }
    seatRef.current = sessionId;

    // 画面が無いので effect は再走せず、戻った席はここでしか返せない。印は倒さない。
    // 倒すと2本目以降の書き戻しを落とし、その席が Rust に残る。
    // 送るのは席を指さない停止で、落ちても先頭の `sessionId === undefined` で降りるので回り続けない。
    if (unmountedRef.current) {
      queueBehind(async () => {
        if (seatRef.current === null) return;
        await sendStopQuietly("unmount", undefined);
      });
    }
  };

  /**
   * 停止を送り、結末を欄へ反映する。失敗は呼び手へ投げる（飲むのは `sendStopQuietly`）。
   *
   * 成功したとき、席を指していれば握っている席と一致する場合だけ欄を空ける。一致しなければ
   * そこに居るのは新しい席で、巻き添えにできない。指していなければ無条件に空ける。
   * Rust が `stop_all_sessions` で全部空けるので、欄だけ残すと無い席を握ることになる。
   * 覚えるのは往復の前に読んだ席で、往復の間に入った席は覚えない。
   */
  const sendStop = async (by: SeatReleasePoint, sessionId: AnalysisSessionId | undefined) => {
    const held = seatRef.current;
    const generation = engineGenRef.current;

    let outcome: StopOutcome;
    try {
      outcome = await stopAnalysisCore(sessionId, by);
    } catch (e) {
      keepOrForget(sessionId, generation);
      throw e;
    }

    // 席が空なら、指した相手が既に居なくても Rust は `Ok` を返し、別の席が居れば `Err` を返す
    // （`bridge.rs` の `stop_session`）。ここまで来たなら指した席は空いている。
    if (sessionId === undefined) {
      if (held !== null) {
        markReleased(held);
      }
      seatRef.current = null;
      return outcome;
    }

    markReleased(sessionId);
    if (seatRef.current === sessionId) seatRef.current = null;
    return outcome;
  };

  /**
   * 返却の Promise を `releasingRef` に載せる。**この ref に書くのはここだけ。**
   *
   * 空けるのは自分がまだ載っているときだけ。後ろに並んだ返却が居るのに空けると、
   * その返却の応答待ちの間に3本目が並列で出る。
   */
  const holdSlot = (run: () => Promise<void>): Promise<void> => {
    const slot: Promise<void> = run().finally(() => {
      if (releasingRef.current === slot) releasingRef.current = null;
    });
    releasingRef.current = slot;
    return slot;
  };

  /**
   * 応答待ちの返却があれば、その後ろに並んで `run` を走らせる。
   *
   * 並ばずに降りると、先の返却が落ちて席が残ったときに返す者が居ない。棋譜を閉じた後や
   * アンマウント後は effect も再走しない。並ぶときも `holdSlot` を通す。通さないと、同じ返却を
   * 待っている `releaseHeld` が誰も居ないと読んで先へ進み、同じ席へ並列で送る。
   */
  const queueBehind = (run: () => Promise<void>): void => {
    const releasing = releasingRef.current;
    void holdSlot(releasing ? () => releasing.catch(() => {}).then(run) : run);
  };

  /**
   * 停止を送り、落ちたらログだけ残す。解決する Promise を返すので、後ろに並んだ返却が結末を見られる。
   *
   * 落ちても利用者には出せない。画面が無い（`unmount`）、棋譜を閉じた（`no-position`）、
   * 直後に別の断りが立つ（`sync-timeout`）、要求が既に要らなくなっている（`late-start`、`late-restart`）。
   * ログが唯一の手掛かりになるので経路を書く。席が残ると以後の開始が全部断られ、起動し直すまで
   * 解析が始まらない。落ちた後の結末は `analysis.md` の ※1、※12、※14 と不変条件1、3、5 に置く。
   */
  const sendStopQuietly = (by: SeatReleasePoint, sessionId: AnalysisSessionId | undefined) =>
    sendStop(by, sessionId).then(
      () => {},
      (e: unknown) => {
        console.warn("[ANALYSIS] failed to release the engine session", { by, sessionId }, e);
      },
    );

  /**
   * 応答待ちの停止を、前の返却ごと `releasingRef` に載せる。
   *
   * 載せないと、この停止の応答待ちの間に次の再開が `releaseHeld` を素通りし、捨てた席が Rust に
   * 居るうちに開始を頼んで断られ、解析が黙って止まる。
   * 前の返却を畳み込まないと、こちらが先に解決した時点で後から並ぶ側が誰も居ないと読み、
   * まだ応答待ちの席へ2本目を送る。
   */
  const foldIntoSlot = (shot: Promise<void>) => {
    const previous = releasingRef.current;
    void holdSlot(() => Promise.allSettled([previous, shot]).then(() => {}));
  };

  /**
   * 要らなくなった開始が持ってきた席を捨てる。握っている席には触らない。
   *
   * 捨てられなければ `sendStop` の catch が欄へ書き戻すので、その席を知る者は残る。
   */
  const discard = (by: DiscardReleasePoint, sessionId: AnalysisSessionId) => {
    // 停止の応答が返るまで Rust はこの席の `info` を配り続ける。応答を待って覚えると、
    // 前の局面の読み筋が盤に出る。
    markReleased(sessionId);

    foldIntoSlot(sendStopQuietly(by, sessionId));
  };

  apiRef.current = {
    isHeld: () => seatRef.current !== null,
    engineGeneration: () => engineGenRef.current,
    accepts: (sessionId) => {
      if (releasedRef.current.has(sessionId)) return false;
      return seatRef.current === null || seatRef.current === sessionId;
    },
    beginTake: (discardBy, engineUsable) => {
      const generation = engineGenRef.current;

      return {
        hasEngineChanged: () => engineGenRef.current !== generation || !engineUsable(),
        receiveSeat: (sessionId, isSuperseded) => {
          if (engineGenRef.current !== generation || !engineUsable()) {
            markReleased(sessionId);
            return "engine-gone";
          }

          // 識別子は Rust が新しく振るので、ここで当たるのは開始の応答より先に完了が届いた席だけ。
          // もう Rust に無いので、要らなくなっていても停止は送らない。
          if (releasedRef.current.has(sessionId)) return isSuperseded() ? "superseded" : "finished";

          if (isSuperseded()) {
            discard(discardBy, sessionId);
            return "superseded";
          }

          seatRef.current = sessionId;
          return "held";
        },
      };
    },
    onEngineGone: () => {
      engineGenRef.current++;

      const held = seatRef.current;
      if (held === null) return;
      seatRef.current = null;
      markReleased(held);
    },
    closeFinished: (sessionId) => {
      if (seatRef.current !== null && seatRef.current !== sessionId) return;
      seatRef.current = null;
      markReleased(sessionId);
    },

    releaseHeld: async (by) => {
      // 応答待ちの返却に相乗りせず、待ってから結末を自分で確かめる。待てない側は失敗を飲むので、
      // 相乗りすると席を握ったまま返せたことになる。
      // 待っている間に並んだ分も待つ。入口で見た1本だけを待つと、同じ席へ並列で送る。
      while (releasingRef.current) {
        const releasing = releasingRef.current;
        await releasing.catch(() => {});
        if (releasingRef.current === releasing) break;
      }

      const held = seatRef.current;
      if (held === null) return "stopped";

      let outcome: StopOutcome = "stopped";
      await holdSlot(async () => {
        outcome = await sendStop(by, held);
      });
      return outcome;
    },

    releaseHeldQuietly: (by) => {
      // 席は送る直前に読む。並んでいる間に返し終えることも、落ちた返却が書き戻すこともある。
      queueBehind(async () => {
        const held = seatRef.current;
        if (held === null) return;
        await sendStopQuietly(by, held);
      });
    },

    markMounted: () => {
      unmountedRef.current = false;
    },

    // React の state が消えても Rust の `active_sessions` から席は消えない。残すと以後の開始が
    // 全部断られ、エンジンを起動し直すまで解析が始まらない。席を指さない理由は ※12 に置く。
    sweepOnUnmount: () => {
      unmountedRef.current = true;

      queueBehind(async () => {
        // 席は `releasingRef` が空いてから読む。アンマウントの時点で読むと、応答待ちの停止が
        // この後に落ちて席を書き戻したときに取り残す。開始の応答待ちで欄が空なら、
        // 残った席を返すのは応答が返った側（`discard`）。
        if (seatRef.current === null) return;

        await sendStopQuietly("unmount", undefined);
      });
    },
  };

  return apiRef.current;
}
