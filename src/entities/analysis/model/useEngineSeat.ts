import { useRef } from "react";
import { stopAnalysis as stopAnalysisCore } from "@/entities/engine/api/tauri";

/**
 * 席を返した口。**ログを切り分けるためだけに在る**（Rust のログにもそのまま出る）。
 *
 * 値を増やすときは、その口が落ちたときの結末（返し直せるのか、誰も返せないのか）を
 * `releaseHeldQuietly` の doc に書き足すこと。書けないなら、その口は要らない。
 */
export type SeatReleasePoint =
  | "stop"
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
   * 失敗は呼び手へ投げる（口の名前を取らないのはそのため——出し方は呼び手が決める）。
   */
  releaseHeld: () => Promise<void>;
  /** 応答を待てない場所から、握っている席を返す */
  releaseHeldQuietly: (at: SeatReleasePoint) => void;
  /** 畳まれたときの後始末。**席を指さずに撃つ**ので、他の口とは別の関数にしてある */
  sweepOnUnmount: () => void;
  /** 要らなくなった開始が持ってきた席を捨てる。**握っている席には触らない** */
  discard: (at: SeatReleasePoint, sessionId: string) => void;
}

export function useEngineSeat(): EngineSeat {
  const seatRef = useRef<string | null>(null);

  // 直前に返した席。**採ってはいけない `info` を見分けるためだけに持つ。**
  const retiredRef = useRef<string | null>(null);

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。
  // 描画のたびに別物を返すと、依存が毎回変わって cleanup が走る
  // ——畳まれてもいないのに後始末が撃たれる。
  const apiRef = useRef<EngineSeat | null>(null);

  const send = async (at: SeatReleasePoint, sessionId: string | undefined) => {
    const held = seatRef.current;

    try {
      await stopAnalysisCore(sessionId, at);
    } catch (e) {
      // **返せなかった席を、誰も知らないままにしない。** 欄が空なら握り直す。
      // 要らなくなった開始を捨てる口は欄が空のまま撃つので、書き戻さないと
      // `sweepOnUnmount` が門で止まり、二度と返す機会が来ない。
      // 欄が埋まっているなら触らない——そちらは新しい席で、巻き添えにできない。
      if (sessionId !== undefined && seatRef.current === null) {
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

  // **落ちても利用者には出せない。** ここを通るのは、画面が既に無い（`unmount`）、
  // 読む局面が無くなった（`no-position`。棋譜を閉じた後なので出す場所が無い）、
  // 直後に別のエラーを出す（`sync-timeout`）、利用者が止めた直後で
  // 「停止の後始末に失敗しました」を出しても当てが無い（`late-start` / `late-restart`）。
  //
  // **それでも痕跡は残す。** ここが最後の防壁で、抜けられると席が残り、
  // 以降の解析が全部「Analysis already running」で断られる。しかもその失敗は
  // 「▶ を押しても何も起きない」という形でしか現れない
  // （`docs/state-transitions/analysis.md` ※4）ので、ログが無いと手掛かりが1つも無い。
  //
  // **どの口から撃ったかを書く。** 落ちた後の結末が違う——画面が畳まれた後
  // （`unmount`、および畳まれた後に返ってきた `late-*`）は握り直しても読む者が
  // 居ないので、エンジンを畳み直すしかない。画面が生きている回は握り直すので、
  // 次に畳まれたときに返し直せる（それまで ▶ は Rust に断られ続ける）。
  const quietly = (at: SeatReleasePoint, sessionId: string | undefined) => {
    void send(at, sessionId).catch((e) => {
      console.warn("[ANALYSIS] failed to release the engine session", { at, sessionId }, e);
    });
  };

  if (apiRef.current) return apiRef.current;

  apiRef.current = {
    isHeld: () => seatRef.current !== null,
    matches: (sessionId) =>
      seatRef.current !== null ? seatRef.current === sessionId : sessionId !== retiredRef.current,
    hold: (sessionId) => {
      seatRef.current = sessionId;
    },
    forget: (sessionId) => {
      if (seatRef.current !== sessionId) return;
      seatRef.current = null;
      retiredRef.current = sessionId;
    },

    releaseHeld: async () => {
      const held = seatRef.current;
      if (held === null) return;
      await send("stop", held);
    },

    releaseHeldQuietly: (at) => {
      const held = seatRef.current;
      if (held === null) return;
      quietly(at, held);
    },

    // React の state が消えても、Rust の `active_sessions` からは席が消えない。
    // 置いていくと、以降 start_infinite_analysis が「Analysis already running」で
    // 断られ、エンジンを畳み直すまで解析が二度と始まらない。
    //
    // **ここだけ席を指さない。** 指した ID が席の主でなければ Rust は照合して断り
    // （`bridge.rs` の `stop_session`）、席は残ったままになる。握っている ID が
    // 主とずれる経路は `docs/state-transitions/analysis.md` ※12 に挙げてある。
    // 画面が居ない以上どの解析も要らないので、指さずに全部返す。
    sweepOnUnmount: () => {
      if (seatRef.current === null) return;
      quietly("unmount", undefined);
    },

    discard: (at, sessionId) => {
      quietly(at, sessionId);
    },
  };

  return apiRef.current;
}
