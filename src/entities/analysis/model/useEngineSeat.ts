import { useRef } from "react";
import {
  stopAnalysis as stopAnalysisCore,
  type SeatReleasePoint,
} from "@/entities/engine/api/tauri";

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
   * **握っているときは厳密一致。握っていないときは「もう採らない席」だけを落とす。**
   * 席が欄に入るのは開始の応答が返った後なので、それより早く届く `info`
   * ——探索を始めた直後のいちばん出したい1本——を「自分のじゃない」と落とさないため。
   *
   * 「もう採らない席」は2つ。**返した席**と、**捨てると決めた席**（停止の応答を待たない）。
   * 採ると、前の局面の評価値と読み筋が現在の盤面の解析結果として出る。
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
   * 撃つのは `sync-timeout` と `no-position` の2口。
   * **落ちたときの結末は `shootQuietly` の頭に1つ置いてある。**
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

  // **もう採らない席。** 返した席と、捨てると決めた席の両方が入る
  // （`matches` から見ればどちらも同じ「採らない」。違うのは入れる時点だけで、
  // 捨てる側は停止の応答を待たない——待つと前の局面の読み筋が盤に出る）。
  //
  // **1枠ではなく集合。** 1枠だと、席を続けて2つ手放したときに古い方が
  // 「採らない」から外れ、その遅れた `info` がまた通る。
  //
  // **席を握り直しても忘れない。** 忘れると、盤を1手ずつ動かす普通の経路
  // （返す→握る→返す）で1枠と同じところまで戻る。握っている席の照合が
  // 厳密一致でも足りない——捨てた席を握り直す枝（下の catch）があるので、
  // `matches` は席よりこちらを先に見る。
  //
  // **上限で切る。** 遅れて届く `info` は探索1本ぶんの窓に収まるので、
  // 古い方から落として構わない。切らないと解析を繰り返すぶんだけ育つ。
  const ignoredRef = useRef<Map<string, true>>(new Map());

  /** 「採らない席」の上限。**探索1本の `info` の窓を覆えれば足りる。** */
  const IGNORED_LIMIT = 32;

  const rememberIgnored = (sessionId: string) => {
    ignoredRef.current.delete(sessionId);
    ignoredRef.current.set(sessionId, true);
    while (ignoredRef.current.size > IGNORED_LIMIT) {
      const oldest = ignoredRef.current.keys().next();
      if (oldest.done) break;
      ignoredRef.current.delete(oldest.value);
    }
  };

  // **Rust がもう持っていない席。** 停止が成功した回と、完了通知で片付いた回。
  // 返せなかった席を握り直すとき（下の catch）、**ここに在る席は握らない**
  // ——Rust に無いものを握ると、次に畳まれたときの後始末が
  // 席を指さない停止に落ちる。
  const returnedRef = useRef<Set<string>>(new Set());

  // 飛んでいる返却。**引き金が重なったときに、同じ席へ2本目を並べて撃たないため**に持つ。
  // 重ねても Rust は断らない（席が空なら `Ok`。`bridge.rs` の `stop_session`）が、
  // 2本目は無駄で、順序も結末も保証できない。口ごとに振る舞いが違う。
  //
  // - **待てる側**（`releaseHeld`）——枠が自分のものになるまで待ってから、席を見直す
  // - **待てない側**（`releaseHeldQuietly` / `sweepOnUnmount`）——後ろに並び、
  //   **席がまだ握られていれば**撃ち直す
  // - **`discard`**——並ばずに枠を差し替える。捨てる席は握っている席ではないので、
  //   先に飛んでいる返却と**別の席**を指す。同じ席に2本出ることはない。
  //   ただし**枠を待っている `releaseHeld` は、差し替えたこちらを待つ**
  //   ——それでよい。要らなくなった席が Rust から消えるまで、次の開始は始められない
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
      // 握ることになり、次に畳まれたときの後始末が席を指さない停止に落ちる
      // （`returnedRef` を空ける口は `send` の成功と `forget`＝完了通知の2つ）。
      if (
        sessionId !== undefined &&
        seatRef.current === null &&
        !returnedRef.current.has(sessionId)
      ) {
        seatRef.current = sessionId;
      }
      throw e;
    }

    // 席が空なら、指した相手が既に居なくても Rust は `Ok` を返す
    // （`bridge.rs` の `stop_session`。**別のセッションが居れば `Err`**）。
    // ここまで来た時点で、指した席は空いている。
    if (sessionId === undefined) {
      if (held !== null) {
        rememberIgnored(held);
        returnedRef.current.add(held);
      }
      seatRef.current = null;
      return;
    }

    rememberIgnored(sessionId);
    returnedRef.current.add(sessionId);
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
      // **採らない席を先に見る。** 捨てた席を握り直す枝があるので、
      // 席の照合を先にすると、捨てると決めた席が「自分の席」に昇格して通る。
      if (ignoredRef.current.has(sessionId)) return false;
      return seatRef.current === null || seatRef.current === sessionId;
    },
    hold: (sessionId) => {
      seatRef.current = sessionId;
      // 握った席は「採らない」から外す。捨ててから握り直す枝を通ると入っている。
      ignoredRef.current.delete(sessionId);
      returnedRef.current.delete(sessionId);
    },
    forget: (sessionId) => {
      if (seatRef.current !== sessionId) return;
      seatRef.current = null;
      rememberIgnored(sessionId);
      returnedRef.current.add(sessionId);
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
      // **並ぶときも枠を取る。** 取らないと、同じ1本を待っている `releaseHeld` が
      // 「誰も並んでいない」と見て先に進み、この停止と並列で同じ席へ撃つ。
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
      // ここも `releaseHeldQuietly` と同じ理由で枠を取る。取らずに並ぶと、
      // 待っている `releaseHeld` が枠の空きを見て先へ進み、席を指す停止と
      // 指さない停止が同じ席へ並列で出る。
      const releasing = releasingRef.current;
      if (releasing) {
        const queued: Promise<void> = releasing
          .catch(() => {})
          .then(() => {
            if (seatRef.current === null) return;
            return shootQuietly("unmount", undefined);
          })
          .finally(() => {
            if (releasingRef.current === queued) releasingRef.current = null;
          });
        releasingRef.current = queued;
        return;
      }

      const sending: Promise<void> = shootQuietly("unmount", undefined).finally(() => {
        if (releasingRef.current === sending) releasingRef.current = null;
      });
      releasingRef.current = sending;
    },

    discard: (by, sessionId) => {
      // **捨てると決めた時点で `info` を落とす。** 停止の応答が返るまで Rust は
      // その席の `info` を配り続けるので、待つと前の局面の読み筋が盤に出る。
      rememberIgnored(sessionId);

      // **枠に載せる。** 載せないと、この停止が飛んでいる間に次の再開が
      // `releaseHeld` を素通りし（こちらは席を握っていない）、
      // 捨てた席がまだ Rust に居るうちに `start_infinite_analysis` を投げる
      // ——`take_session` が断って、解析が黙って停止中になる。
      const sending: Promise<void> = shootQuietly(by, sessionId).finally(() => {
        if (releasingRef.current === sending) releasingRef.current = null;
      });
      releasingRef.current = sending;
    },
  };

  return apiRef.current;
}
