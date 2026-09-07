import { useRef } from "react";
import { stopAnalysis as stopAnalysisCore } from "@/entities/engine/api/tauri";

/**
 * 席を返した口。**ログを切り分けるためだけに在る**（Rust のログにもそのまま出る）。
 *
 * 値を増やすときは、その口が落ちたときの結末（返し直せるのか、誰も返せないのか）を
 * **その値を撃つ関数の doc** に書き足すこと。書けないなら、その口は要らない。
 */
export type SeatReleasePoint =
  | "stop"
  | "start"
  | "restart"
  | "unmount"
  | "no-position"
  | "sync-timeout"
  | "late-start"
  | "late-restart";

/**
 * Rust が渡した解析の席（`active_sessions` の1エントリ）の生死を持つ。
 *
 * **席の識別子を書き換えるのはこのフックの中だけ。** 書ける場所を増やすと、
 * 経路を1本足すたびに「握ったまま終わる」「席は在るのに欄が空」を目で数えることになる。
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
   * **握っていないときは、直前に返した席のものだけを落とす。** 席が欄に入るのは
   * 開始の応答が返った後なので、それより早く届く `info`——探索を始めた直後の
   * いちばん出したい1本——を「自分のじゃない」と落とさないため。
   * かわりに、返したばかりの席の `info` は落とす。採ると、前の局面の評価値と
   * 読み筋が現在の盤面の解析結果として出る。
   */
  matches: (sessionId: string) => boolean;
  /** Rust が席を渡した行で呼ぶ。**要らない要求だと分かった後に呼ばない** */
  hold: (sessionId: string) => void;
  /** Rust が自分で片付けた席を、こちらの記録から落とす */
  forget: (sessionId: string) => void;
  /**
   * 握っている席を返す。握っていなければ何もしない。
   *
   * **返せたときだけ手放す。** 停止が失敗したら握ったままにして、次に返せる機会へ持ち越す。
   * 失敗は呼び手へ投げる（出し方は呼び手が決める）。
   */
  releaseHeld: (by: SeatReleasePoint) => Promise<void>;
  /**
   * 応答を待てない場所から、握っている席を返す。握っていなければ何もしない。
   *
   * 撃つのは `sync-timeout` と `no-position` の2口。**落ちても利用者には出せない。**
   * 落ちた席は握ったままにするので、`sync-timeout` は ▶ が、`no-position` は
   * 棋譜を開き直してからの ▶ が返し直す（口ごとの結末は `shootQuietly` の頭に1つ置く）。
   */
  releaseHeldQuietly: (by: SeatReleasePoint) => void;
  /**
   * 畳まれたときの後始末。**席を指さずに撃つ**ので、他の口とは別の関数にしてある。
   * 落ちた回は誰も返せない（読む者が居ない）。
   */
  sweepOnUnmount: () => void;
  /**
   * 要らなくなった開始が持ってきた席を捨てる。**握っている席には触らない。**
   *
   * **捨てられなかったときは握る**（欄が空で、まだ返し終えていない席のとき）。
   * 呼んだ後に `isHeld()` が true になりうるのはこの形だけで、そうしないと
   * その席を知る者が居なくなる。畳まれた後に落ちた回は誰も返せない。
   */
  discard: (by: SeatReleasePoint, sessionId: string) => void;
}

export function useEngineSeat(): EngineSeat {
  const seatRef = useRef<string | null>(null);

  // 直前に返した席。**採ってはいけない `info` を見分けるためだけに持つ。**
  const retiredRef = useRef<string | null>(null);

  // 捨てると決めた席。**停止の応答が返る前から `info` を落とす**ために持つ。
  // `retiredRef` は停止が解決してから書くので、その往復の間だけ
  // 「席は空・まだ retired でもない」になり、捨てた席の `info` が通ってしまう。
  const discardingRef = useRef<Set<string>>(new Set());

  // 飛んでいる返却。**引き金が重なったときに、同じ席へ2本目を並べて撃たないため**に持つ。
  // 重ねても Rust は断らない（席が空なら `Ok`。`bridge.rs` の `stop_session`）が、
  // 2本目は無駄で、順序も結末も保証できない。口ごとに振る舞いが違う。
  //
  // - **待てる側**（`releaseHeld`）——枠が自分のものになるまで待ってから、席を見直す
  // - **待てない側**（`releaseHeldQuietly` / `sweepOnUnmount`）——後ろに並び、
  //   **席がまだ握られていれば**撃ち直す
  // - **`discard`**——握っている席に触らないので並ばず、枠を差し替える。
  //   並列にならないのは、開始が飛んでいる間は席の欄が必ず空だから（→ ※13）
  const releasingRef = useRef<Promise<void> | null>(null);

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。
  // 描画のたびに別物を返すと、依存が毎回変わって cleanup が走る
  // ——畳まれてもいないのに後始末が撃たれる。
  const apiRef = useRef<EngineSeat | null>(null);

  const send = async (by: SeatReleasePoint, sessionId: string | undefined) => {
    const held = seatRef.current;

    try {
      await stopAnalysisCore(sessionId, by);
    } catch (e) {
      // **返せなかった席を、誰も知らないままにしない。** 欄が空なら握り直す。
      // 要らなくなった開始を捨てる口は欄が空のまま撃つので、書き戻さないと
      // `sweepOnUnmount` が門で止まり、二度と返す機会が来ない。
      //
      // 握り直さないのは2つ。**欄が埋まっている**なら、そちらは新しい席で
      // 巻き添えにできない。**既に返し終えた席**なら、Rust にもう無いものを
      // 握ることになり、次に畳まれたときの後始末が席を指さない停止に落ちる。
      if (sessionId !== undefined && seatRef.current === null && retiredRef.current !== sessionId) {
        seatRef.current = sessionId;
      }
      throw e;
    }

    // 席が空なら、指した相手が既に居なくても Rust は `Ok` を返す
    // （`bridge.rs` の `stop_session`。**別のセッションが居れば `Err`**）。
    // ここまで来た時点で、指した席は空いている。
    if (sessionId === undefined) {
      retiredRef.current = held;
      seatRef.current = null;
      return;
    }

    retiredRef.current = sessionId;
    // **自分が握っている席と違うなら手放さない。** 新しい席を巻き添えにする。
    if (seatRef.current === sessionId) seatRef.current = null;
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
  // その返却も落ちた回は、表示が停止中のまま `console.error` だけが残る（→ ※1 / F-7）。
  // **解決する Promise を返す**ので、後ろに並んだ返却がその結末を見られる。
  const shootQuietly = (by: SeatReleasePoint, sessionId: string | undefined) =>
    send(by, sessionId).catch((e) => {
      console.warn("[ANALYSIS] failed to release the engine session", { by, sessionId }, e);
    });

  if (apiRef.current) return apiRef.current;

  apiRef.current = {
    isHeld: () => seatRef.current !== null,
    matches: (sessionId) => {
      if (discardingRef.current.has(sessionId)) return false;
      return seatRef.current !== null
        ? seatRef.current === sessionId
        : sessionId !== retiredRef.current;
    },
    hold: (sessionId) => {
      seatRef.current = sessionId;
    },
    forget: (sessionId) => {
      if (seatRef.current !== sessionId) return;
      seatRef.current = null;
      retiredRef.current = sessionId;
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

      const sending: Promise<void> = send(by, held).finally(() => {
        // **自分がまだ枠に居るときだけ空ける。** 後ろに並んだ返却が居るのに
        // 空けると、その返却が飛んでいる間に3本目が並列で出る。
        if (releasingRef.current === sending) releasingRef.current = null;
      });
      releasingRef.current = sending;
      return sending;
    },

    releaseHeldQuietly: (by) => {
      // **飛んでいる返却があるなら、その後ろに並ぶ。** 降りてしまうと、
      // その返却が落ちたとき（席は握ったまま残る）に撃ち直す者が居ない
      // ——棋譜を閉じた回はもう画面が無いので、依存が動いて effect が
      // 再走することも無い。
      const releasing = releasingRef.current;
      if (releasing) {
        const queued: Promise<void> = releasing
          .catch(() => {})
          .then(() => {
            if (seatRef.current === null) return;
            return shootQuietly(by, seatRef.current);
          })
          .finally(() => {
            if (releasingRef.current === queued) releasingRef.current = null;
          });
        releasingRef.current = queued;
        return;
      }

      const held = seatRef.current;
      if (held === null) return;

      const sending: Promise<void> = shootQuietly(by, held).finally(() => {
        if (releasingRef.current === sending) releasingRef.current = null;
      });
      releasingRef.current = sending;
    },

    // React の state が消えても、Rust の `active_sessions` からは席が消えない。
    // 置いていくと、以降 start_infinite_analysis が「Analysis already running」で
    // 断られ、エンジンを畳み直すまで解析が二度と始まらない。
    //
    // **ここだけ席を指さない。** 理由は `docs/state-transitions/analysis.md` ※12 に1つ置いてある。
    sweepOnUnmount: () => {
      if (seatRef.current === null) return;

      // **指さない停止は席を全部空ける**ので、開始が席を取ってから `go` が線に出るまでに
      // 割り込むと「席は空・エンジンは探索中」になる → #463。だから後ろに並ぶ。
      const releasing = releasingRef.current;
      if (releasing) {
        void releasing
          .catch(() => {})
          .then(() => {
            if (seatRef.current === null) return;
            return shootQuietly("unmount", undefined);
          });
        return;
      }

      void shootQuietly("unmount", undefined);
    },

    discard: (by, sessionId) => {
      // **捨てると決めた時点で `info` を落とす。** 停止の応答が返るまで Rust は
      // その席の `info` を配り続けるので、待つと前の局面の読み筋が盤に出る。
      discardingRef.current.add(sessionId);

      // **枠に載せる。** 載せないと、この停止が飛んでいる間に次の再開が
      // `releaseHeld` を素通りし（こちらは席を握っていない）、
      // 捨てた席がまだ Rust に居るうちに `start_infinite_analysis` を投げる
      // ——`take_session` が断って、解析が黙って停止中になる。
      const sending: Promise<void> = shootQuietly(by, sessionId).finally(() => {
        // 握り直した回（`send` の catch）は落とし続ける。その席はまだ Rust に居る。
        if (seatRef.current !== sessionId) discardingRef.current.delete(sessionId);
        if (releasingRef.current === sending) releasingRef.current = null;
      });
      releasingRef.current = sending;
    },
  };

  return apiRef.current;
}
