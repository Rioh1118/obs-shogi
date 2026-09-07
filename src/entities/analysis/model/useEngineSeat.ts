import { useRef } from "react";
import {
  stopAnalysis as stopAnalysisCore,
  type AnalysisSessionId,
  type SeatReleasePoint,
} from "@/entities/engine/api/tauri";

/**
 * 口ごとの部分集合。**分け方は席を返す口の性質**（応答を待てるか・捨てる側か）で、
 * Rust が受け取る値の集合（`SeatReleasePoint`）とは別の関心なので、こちら側で持つ。
 *
 * 値を取り違えても Rust は止まるので壊れるのはログだけ——#441 の再発を追う人が読む
 * 唯一の手掛かりが嘘になる。型で割っておけば `releaseHeldQuietly("unmount")` は tsc が止める。
 */
export type BlockingReleasePoint = Extract<SeatReleasePoint, "stop" | "start" | "restart">;
/** 応答を待てない口。落ちても画面に出せない（結末は `shootQuietly` の頭） */
export type QuietReleasePoint = Extract<SeatReleasePoint, "sync-timeout" | "no-position">;
/** 要らなくなった開始が持ってきた席を捨てる口 */
export type DiscardPoint = Extract<SeatReleasePoint, "late-start" | "late-restart">;

/**
 * どの口の引数にもならない値。**綴りは `sweepOnUnmount` の中だけに書く**
 * ——引数にできると `releaseHeldQuietly("unmount")` が通ってしまう。
 */
type InlineOnlyReleasePoint = "unmount";

/**
 * **どの部分集合にも入れていない値を tsc に落とさせる。** `Extract` は綴りを間違えても
 * 黙って狭まるので、`SeatReleasePoint` に値を足して割り当てを忘れた回をここで止める。
 */
type _EveryPointIsAssigned =
  Exclude<
    SeatReleasePoint,
    BlockingReleasePoint | QuietReleasePoint | DiscardPoint | InlineOnlyReleasePoint
  > extends never
    ? true
    : never;
const _everyPointIsAssigned: _EveryPointIsAssigned = true;
void _everyPointIsAssigned;

/** 返ってきた席をどう扱ったか。**呼び手はこの3つを全部書き分ける。** */
export type SeatTakeResult = "held" | "engine-gone" | "superseded";

/**
 * 席を取る往復の、行きと帰りを結ぶ札。**`beginTake` でしか作れない。**
 *
 * 往復を跨いで「その席はどのエンジンのものか」を言うために要る。エンジンの世代を
 * 呼び手に持たせると、席を取る口を1本足すたびに門を通したかを目で数えることになる。
 */
export interface SeatTake {
  /**
   * Rust が席を渡した行で呼ぶ。**握るか捨てるかはここで決まる。**
   *
   * 見る順は**エンジンが先**——往復の間に消えていたら、要求がまだ生きていても
   * その席は死んでいる。消えていた回は撃たずに捨てる（撃つと起こし直したエンジンへ
   * 裸の `stop` が書かれる。→ `docs/state-transitions/analysis.md` の ※12）。
   * 要らなくなっていた回は撃って捨てる（`discard`）。
   */
  landed: (sessionId: AnalysisSessionId, isSuperseded: () => boolean) => SeatTakeResult;
}

/**
 * Rust が渡した解析の席（`active_sessions` の1エントリ）の生死を持つ。
 *
 * **席の識別子を書き換えるのはこのフックの中だけ。** 書ける場所を増やすと、
 * 経路を1本足すたびに「握ったまま終わる」「席は在るのに欄が空」を目で数えることになる。
 * **エンジンの世代も同じ理由でここに閉じる**——席の生死は「欄が埋まっているか」と
 * 「その席のエンジンがまだ居るか」の両方で決まるので、片方だけを外に置くと
 * 判定が2つのモジュールに割れる。
 *
 * **席の在処を `state` から導かない。** 理由と、どの失敗で席が本当に Rust に残るかは
 * `docs/state-transitions/analysis.md` の ※12 に1つだけ置いてある。
 */
export interface EngineSeat {
  /** 席を握っているか */
  isHeld: () => boolean;
  /**
   * 届いた通知を採ってよいか。
   *
   * **まず、手放した席を落とす**（握り直していても落とす。停止が落ちた回は
   * 捨てると決めた席を握り直すので、席の照合を先にすると通ってしまう）。
   * **残りは、握っていれば厳密一致、握っていなければ通す。**
   * 席が欄に入るのは開始の応答が返った後なので、それより早く届く `info`
   * ——探索を始めた直後のいちばん出したい1本——を「自分のじゃない」と落とさないため。
   *
   * 採ると、前の局面の評価値と読み筋が現在の盤面の解析結果として出る。
   */
  accepts: (sessionId: AnalysisSessionId) => boolean;
  /**
   * 席を取りに行く**前**に呼ぶ。返る札を、席が返ってきた行で使う。
   *
   * **開始を頼む行より前で呼ぶこと。** 後で呼ぶと、往復の間に消えたエンジンを
   * 「まだ居る」と読む——この札が焼き付けるのは、呼んだ時点のエンジンの世代。
   */
  beginTake: (discardBy: DiscardPoint) => SeatTake;
  /**
   * Rust が自分で片付けた席を締める。
   *
   * **握っている席と一致するときだけ効く**——一致しなければ何もしない
   * （走っている別の席を巻き添えにしないため）。効いた回は手放した席として覚えるので、
   * 以後その席の通知は `accepts` が落とす。
   *
   * **書き戻し（`shoot` の catch）はこの記録を見ない。** いま握り直しが起きないのは、
   * 締めた席へ撃つ口が1つも無いから——覚えた席へ撃つ口を足すときは、その口が
   * 握り直しても良いかを別に確かめること。
   */
  closeFinished: (sessionId: AnalysisSessionId) => void;
  /**
   * エンジンごと席が消えたときに、こちらの欄も空ける。**停止は撃たない。**
   *
   * エンジンを畳む側は `stop_all_sessions` で席を全部空けてから落ちる（`bridge.rs` の
   * `shutdown_engine_impl`）。落ちただけの回も `forward_results_to_ui` が席を消す。
   * **撃たない理由は空撃ちではない。** Rust は席の主を照合するので新しい席は巻き添えに
   * ならない（`stop_session`）が、席が空の回は `Ok` のまま `analyzer.stop_analysis()` まで
   * 進み、**起こし直したエンジンへ裸の `stop` が書かれる**。
   * 手放した席として覚えるので、遅れて届く `info` は落ちる。
   *
   * **エンジンの世代も1つ進む。** 進めるのはここだけで、飛んでいる往復
   * （`beginTake` の札と、`shoot` の応答待ち）はこれを見て「もう無いエンジンの席」を
   * 握らずに捨てる。立ち下がりを1回見るだけでは、往復の後に着地する席を止められない。
   */
  onEngineGone: () => void;
  /**
   * 握っている席を返す。
   *
   * **飛んでいる返却があれば、握っていなくても枠が空くまで待つ。** この待ちを外すと、
   * `shoot` の catch が「誰も知らない席は作れない」と言える根拠が消える。
   * 待ち切った時点で席を握っていなければ撃たない。
   *
   * **返せたときだけ手放す。** 停止が失敗したら握ったままにして、次に返せる機会へ持ち越す。
   * 失敗は呼び手へ投げる（出し方は呼び手が決める）。
   */
  releaseHeld: (by: BlockingReleasePoint) => Promise<void>;
  /**
   * 応答を待てない場所から、握っている席を返す。握っていなければ何もしない。
   *
   * **落ちたときの結末は `shootQuietly` の頭に1つ置いてある。**
   */
  releaseHeldQuietly: (by: QuietReleasePoint) => void;
  /**
   * 畳まれたときの後始末。**席を指さずに撃つ**ので、他の口とは別の関数にしてある。
   * 落ちた回は誰も返せない（読む者が居ない）。
   *
   * **席を握っていない回は撃たない**（→ #463。理由は本体の門に置いてある）。
   */
  sweepOnUnmount: () => void;
}

/**
 * 手放した席を覚えておく本数。
 *
 * **数えるのは `info` ではなく席。** 遅れた `info` が届き得るのは、その席を
 * 手放してから停止が Rust に届くまでで、その間に重なる席はたかだか数本
 * （盤を連打しても、再開は1本ずつ直列に走る）。桁1つぶん余裕を取ってこの値。
 */
const PAST_LIMIT = 32;

export function useEngineSeat(): EngineSeat {
  const seatRef = useRef<AnalysisSessionId | null>(null);

  /**
   * エンジンの世代。**`onEngineGone` でだけ進む。**
   *
   * 往復（席を取りに行く行き帰り、停止の応答待ち）を跨いで「その席はどのエンジンの
   * ものか」を言うために持つ。進んだ後に着地した席は**もう無いエンジン**のもので、
   * 握ると「解析中の表示のまま数字が動かない」に落ちる。
   */
  const engineGenRef = useRef(0);

  /**
   * 手放した席。**もう採らない**（`accepts` が落とす）。
   *
   * 入るのは、返し終えた席・完了通知で片付いた席・捨てると決めた席
   * （捨てる側は停止の応答を待たない。待つと前の局面の読み筋が盤に出る）。
   *
   * **1枠ではなく集合。** 1枠だと、席を続けて2つ手放したときに古い方が
   * 「採らない」から外れ、その遅れた `info` がまた通る。
   *
   * **席を握り直しても消さない。** 消すと、盤を1手ずつ動かす普通の経路
   * （返す→握る→返す）で1枠と同じところまで戻る。
   *
   * **上限で切る。** 切らないと解析を繰り返すぶんだけ育つ（`AnalysisProvider` は
   * `RuntimeProviders` 側に居るので、普通は畳まれない）。
   *
   * **「Rust がもう持っていない席」を別に持たない。** 持っても読む者が居ない——
   * `shoot` に渡る識別子は、握っている席か、`discard` が受け取った新しい UUID
   * （`bridge.rs` の `new_session_id`）だけなので、**返し終えた席で停止が落ちる
   * 経路そのものが無い**。逆に「Rust に無い席を握ってしまう回」は在るが、
   * それは区別できない——`stop_session` は席を消してからエンジンを止めるので、
   * エンジン側の失敗は「席は空・`Err`」で返る（→ `analysis.md` ※12）。
   */
  const pastRef = useRef<Set<string>>(new Set());

  // 飛んでいる返却。**引き金が重なったときに、同じ席へ2本目を並べて撃たないため**に持つ。
  // 重ねても Rust は断らない（席が空なら `Ok`。`bridge.rs` の `stop_session`）が、
  // 2本目は無駄で、順序も結末も保証できない。口ごとに振る舞いが違う。
  //
  // - **待てる側**（`releaseHeld`）——枠が自分のものになるまで待ってから、席を見直す
  // - **待てない側**（`releaseHeldQuietly` / `sweepOnUnmount`）——後ろに並び、
  //   **席がまだ握られていれば**撃ち直す
  // - **`discard`**——並ばずに撃つが、枠には**前の返却とこの停止の両方**を載せる
  //   （載せないと後から並ぶ側が前の返却を見失う。理由は `discard` の本体に1つ）。
  //   枠を待っている `releaseHeld` は両方を待つ——それでよい。要らなくなった席が
  //   Rust から消えるまで、次の開始は始められない
  const releasingRef = useRef<Promise<void> | null>(null);

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。
  // 描画のたびに別物を返すと、依存が毎回変わって cleanup が走る
  // ——畳まれてもいないのに後始末が撃たれる。
  const apiRef = useRef<EngineSeat | null>(null);

  // **ここから下は初回の描画でしか走らない。** 返す口は初回のクロージャで凍るので、
  // 下で読んだ値は**その1回の値のまま**——描画ごとに変わる値（props や別のフックの
  // 戻り値）をここで読むと、以後ずっと初回の値を見る。tsc も lint も止めない。
  // **`useRef` 以外を上に置かない**のはそのため（`src/entities/analysis/model/__tests__/seatSlotShape.ratchet.test.ts` が見る）。
  if (apiRef.current) return apiRef.current;

  const remember = (sessionId: AnalysisSessionId) => {
    // 入れ直して最後尾へ。`Set` は挿入順を保つので、先頭が最も古い
    pastRef.current.delete(sessionId);
    pastRef.current.add(sessionId);
    while (pastRef.current.size > PAST_LIMIT) {
      const oldest = pastRef.current.values().next();
      if (oldest.done) break;
      pastRef.current.delete(oldest.value);
    }
  };

  /**
   * 停止を撃つ。**失敗は呼び手へ投げる**（飲む版は `shootQuietly`）。
   *
   * 成功したときに欄を空ける条件は、枝で違う。**席を指した回は、握っている席と
   * 一致するときだけ**——一致しないなら、そこに居るのは新しい席で巻き添えにできない。
   * **指さない回は無条件**（Rust も `stop_all_sessions` で席を全部空けるので、
   * 欄だけ残すと在りもしない席を握ることになる）。覚えるのは**往復の前に読んだ席**で、
   * 往復の間に別の席が入っていても、その席は覚えない。
   *
   * **落ちたときは、欄が空なら撃った席を書き戻す**——誰も知らないまま Rust に残さない。
   */
  const shoot = async (by: SeatReleasePoint, sessionId: AnalysisSessionId | undefined) => {
    const held = seatRef.current;
    const generation = engineGenRef.current;

    try {
      await stopAnalysisCore(sessionId, by);
    } catch (e) {
      // **返せなかった席を、誰も知らないままにしない。** 欄が空なら握り直す。
      // 要らなくなった開始を捨てる口は欄が空のまま撃つので、書き戻さないと
      // `sweepOnUnmount` が門で止まり、二度と返す機会が来ない。
      //
      // **欄が埋まっているなら握らない**——そこに居るのは別の席で、巻き添えにできない。
      // その回、いま撃った席は誰も知らないまま Rust に残りうる（→ `analysis.md` ※12 / F-7）。
      // いまその回が作れないのは、開始する口が必ず枠を待ち切るからで、
      // `discard` の呼び手を増やすときはここを見直すこと。
      //
      // 握った席が Rust にもう無いこともある。**区別できない理由は `pastRef` の doc に1つ。**
      if (sessionId !== undefined && seatRef.current === null) {
        // **往復の間にエンジンが消えていたら書き戻さない。** その席はもう
        // Rust に無く（畳む側が `stop_all_sessions` で空ける）、欄へ戻すと
        // 以後の停止が**次のエンジン**へその識別子で飛ぶ。手放した席として
        // 覚えるだけにして、遅れて届く `info` を落とす。
        if (engineGenRef.current !== generation) {
          remember(sessionId);
        } else {
          seatRef.current = sessionId;
        }
      }
      throw e;
    }

    // 席が空なら、指した相手が既に居なくても Rust は `Ok` を返す
    // （`bridge.rs` の `stop_session`。**別のセッションが居れば `Err`**）。
    // ここまで来た時点で、指した席は空いている。
    if (sessionId === undefined) {
      if (held !== null) {
        remember(held);
      }
      seatRef.current = null;
      return;
    }

    remember(sessionId);
    // **自分が握っている席と違うなら手放さない。** 新しい席を巻き添えにする。
    if (seatRef.current === sessionId) seatRef.current = null;
  };

  /**
   * 枠を1本の Promise で占める。**撃つのは呼び手**（`discard` は枠に載せる前に撃つ）。
   * **`releasingRef` に書く綴りはここだけ。**
   *
   * 口ごとに手で書くと、口を1つ足したときの写し忘れを止める機械が無くなる。
   *
   * **空けるのは自分がまだ枠に居るときだけ。** 後ろに並んだ返却が居るのに
   * 空けると、その返却が飛んでいる間に3本目が並列で出る。
   */
  const holdSlot = (run: () => Promise<void>): Promise<void> => {
    const slot: Promise<void> = run().finally(() => {
      if (releasingRef.current === slot) releasingRef.current = null;
    });
    releasingRef.current = slot;
    return slot;
  };

  /**
   * 飛んでいる返却があれば、その後ろに並んでから撃つ。**応答を待てない口が通る。**
   *
   * 降りてしまうと、先の返却が落ちたとき（席は握ったまま残る）に撃ち直す者が居ない
   * ——棋譜を閉じた回・畳まれた回はもう画面が無いので、依存が動いて effect が
   * 再走することも無い。
   *
   * **並ぶときも枠を取る**（`holdSlot` を通る）。取らないと、同じ1本を待っている
   * `releaseHeld` が「誰も並んでいない」と見て先へ進み、並列で同じ席へ撃つ。
   */
  const queueBehind = (run: () => Promise<void>): void => {
    const releasing = releasingRef.current;
    void holdSlot(releasing ? () => releasing.catch(() => {}).then(run) : run);
  };

  // 撃って、落ちたらログだけ残す。**応答を待てない口はここを通る。**
  //
  // **落ちても利用者には出せない。** 画面が既に無い（`unmount`）、棋譜を閉じた後で
  // 出す場所が無い（`no-position`）、直後に `set_error` が立つ（`sync-timeout`。
  // その `error` の読み手はまだ0 → #277）、利用者が止めた直後で
  // 「停止の後始末に失敗しました」を出しても当てが無い（`late-start` / `late-restart`）。
  //
  // **それでも痕跡は残す。** ここが最後の防壁で、抜けられると席が残り、
  // 以降の解析が全部「Analysis already running」で断られる。しかもその失敗は
  // 「▶ を押しても何も起きない」という形でしか現れない
  // （`docs/state-transitions/analysis.md` ※4）ので、ログが無いと手掛かりが1つも無い。
  //
  // **どの口から撃ったかを書く。** 落ちた後の結末が違う。
  // `unmount` と、畳まれた後に返ってきた `late-*` は、握り直しても読む者が居ないので
  // エンジンを畳み直すしかない。`no-position` は棋譜を開き直してから ▶。
  // 画面が生きている回は ▶ が返し直す（▶ は握っている席を返してから頼む）。
  // その返却も落ちた回は、表示が停止中のまま `console.error` だけが残る（→ `docs/state-transitions/analysis.md` の ※1 / F-7）。
  // **解決する Promise を返す**ので、後ろに並んだ返却がその結末を見られる。
  const shootQuietly = (by: SeatReleasePoint, sessionId: AnalysisSessionId | undefined) =>
    shoot(by, sessionId).catch((e) => {
      console.warn("[ANALYSIS] failed to release the engine session", { by, sessionId }, e);
    });

  /**
   * 要らなくなった開始が持ってきた席を捨てる。**握っている席には触らない。**
   *
   * **捨てられなかったときは握る**（欄が空で、まだ返し終えていない席のとき。
   * 書き戻すのは `shoot` の catch）。そうしないとその席を知る者が居なくなる。
   * 畳まれた後に落ちた回は誰も返せない。
   */
  const discard = (by: DiscardPoint, sessionId: AnalysisSessionId) => {
    // **捨てると決めた時点で `info` を落とす。** 停止の応答が返るまで Rust は
    // その席の `info` を配り続けるので、待つと前の局面の読み筋が盤に出る。
    remember(sessionId);

    // **枠に載せる。** 載せないと、この停止が飛んでいる間に次の再開が
    // `releaseHeld` を素通りし（こちらは席を握っていない）、
    // 捨てた席がまだ Rust に居るうちに `start_infinite_analysis` を投げる
    // ——`take_session` が断って、解析が黙って停止中になる。
    //
    // **待たずに撃つが、前の返却は枠ごと畳み込む。** 捨てる席は握っている席
    // ではないので、先に飛んでいる返却の後ろに並ぶ理由が無い。ただし枠を
    // ただ差し替えると、**後から並ぶ側が前の返却を見失う**——こちらが先に
    // 解決した時点で「誰も飛んでいない」と読み、まだ飛んでいる席へ2本目を撃つ。
    const previous = releasingRef.current;
    const shot = shootQuietly(by, sessionId);
    void holdSlot(() => Promise.allSettled([previous, shot]).then(() => {}));
  };

  apiRef.current = {
    isHeld: () => seatRef.current !== null,
    accepts: (sessionId) => {
      // 順序の理由は `EngineSeat.accepts` の doc に1つ置いてある。
      if (pastRef.current.has(sessionId)) return false;
      return seatRef.current === null || seatRef.current === sessionId;
    },
    beginTake: (discardBy) => {
      const generation = engineGenRef.current;

      return {
        landed: (sessionId, isSuperseded) => {
          // **見る順の理由は `SeatTake.landed` の doc に1つ置いてある。**
          if (engineGenRef.current !== generation) {
            remember(sessionId);
            return "engine-gone";
          }

          if (isSuperseded()) {
            discard(discardBy, sessionId);
            return "superseded";
          }

          // 手放した席の集合には触らない。渡る識別子は必ず新品なので（Rust の
          // `new_session_id` が UUID を振る）、そこに居ることが無い。
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
      remember(held);
    },
    closeFinished: (sessionId) => {
      if (seatRef.current !== sessionId) return;
      seatRef.current = null;
      remember(sessionId);
    },

    releaseHeld: async (by) => {
      // **飛んでいる返却は待つ。ただし結末は自分で確かめる。**
      // 相乗りしたまま返すと、その返却が落ちていても（待てない側は失敗を飲む）
      // 「返せた」ことになり、呼び手は席を握ったまま `go` を出す。
      //
      // **待っている間に後ろへ並んだ分も待つ。** 入口で見た1本だけを待つと、
      // 並んだ側とこちらが同じ席へ並列で撃つ。
      while (releasingRef.current) {
        const releasing = releasingRef.current;
        await releasing.catch(() => {});
        if (releasingRef.current === releasing) break;
      }

      const held = seatRef.current;
      if (held === null) return;

      return holdSlot(() => shoot(by, held));
    },

    releaseHeldQuietly: (by) => {
      // **席は撃つ直前に読み直す。** 並んで待っている間に返し終えていることも、
      // 落ちた返却が別の席を書き戻していることもある。
      queueBehind(async () => {
        const held = seatRef.current;
        if (held === null) return;
        await shootQuietly(by, held);
      });
    },

    // React の state が消えても、Rust の `active_sessions` からは席が消えない。
    // 置いていくと、以降 start_infinite_analysis が「Analysis already running」で
    // 断られ、エンジンを畳み直すまで解析が二度と始まらない。
    //
    // **ここだけ席を指さない。** 理由は `docs/state-transitions/analysis.md` ※12 に1つ置いてある。
    sweepOnUnmount: () => {
      // **席を握っていない回は撃たない。** 指さない停止は席を**全部**空けるので、
      // 開始が席を取ってから `go` が線に出るまでの窓に撃ち込むと
      // 「席は空・エンジンは探索中」になる → #463。その窓では欄がまだ空なので、
      // この門で降りる。そこで残った席を返すのは、応答が返った側（`discard`）。
      if (seatRef.current === null) return;

      queueBehind(async () => {
        if (seatRef.current === null) return;
        await shootQuietly("unmount", undefined);
      });
    },
  };

  return apiRef.current;
}
