import { useRef } from "react";
import { stopAnalysis as stopAnalysisCore } from "@/entities/engine/api/tauri";

/**
 * Rust が渡した解析の席（`active_sessions` の1エントリ）の生死を持つ。
 *
 * **席の識別子を書き換えられるのはこの中だけ。** provider に置いていたときは
 * `seatRef.current = ...` を誰でも書けて、経路を1本足すたびに
 * 「握ったまま終わる」「席は在るのに欄が空」を目で数えることになっていた。
 * #120 → #365 → #441 は全部その形で再発している。
 *
 * **`state` は席を持たない。** React の state を写しても、書かれるのは commit の
 * 後の effect なので、開始の応答が返った直後に畳まれた回は空のまま残り、
 * 席が在るのに「無い」と読む（それが #441 の残り穴だった）。
 *
 * どの失敗で席が本当に Rust に残るかは
 * `docs/state-transitions/analysis.md` の ※12 に1つだけ置いてある。
 */
export interface EngineSeat {
  /** 席を握っているか。畳まれたときに撃つかどうかもこれで決める */
  isHeld: () => boolean;
  /** 届いた通知が、いま握っている席のものか。**握っていなければ全部通す** */
  matches: (sessionId: string) => boolean;
  /** Rust が席を渡した行で呼ぶ。**要らない要求だと分かった後に呼ばない** */
  hold: (sessionId: string) => void;
  /** Rust が自分で片付けた席を、こちらの記録から落とす */
  forget: (sessionId: string) => void;
  /**
   * 席を返す。**返せたときだけ手放す。**
   *
   * 停止が失敗したら握り直して、次に返せる機会（畳まれたとき）へ持ち越す。
   * 手放すと、席の存在を知る者が誰も居なくなる。
   */
  release: (sessionId?: string) => Promise<void>;
  /** 応答を待てない場所（畳まれた後・打ち切り・要らなくなった開始）から返す */
  releaseQuietly: (at: string, sessionId?: string) => void;
  /** 畳まれたときの後始末。握っていなければ何もしない */
  releaseOnUnmount: () => void;
}

export function useEngineSeat(): EngineSeat {
  const seatRef = useRef<string | null>(null);

  // **同じ物を返し続ける。** 呼び手はこれを effect の依存に載せる。
  // 描画のたびに別物を返すと、依存が毎回変わって cleanup が走る
  // ——畳まれてもいないのに `releaseOnUnmount` が撃たれる。
  const apiRef = useRef<EngineSeat | null>(null);

  const release = async (sessionId?: string) => {
    try {
      await stopAnalysisCore(sessionId);
    } catch (e) {
      // **返せなかった席を、誰も知らないままにしない。** 欄が空なら握り直す。
      // 要らなくなった開始を返す口は欄が空のまま撃つので、書き戻さないと
      // `releaseOnUnmount` が門で止まり、二度と返す機会が来ない。
      // 欄が埋まっているなら触らない——そちらは新しい席で、巻き添えにできない。
      if (sessionId !== undefined && seatRef.current === null) {
        seatRef.current = sessionId;
      }
      throw e;
    }

    // 席が空なら、指した相手が既に居なくても Rust は `Ok` を返す
    // （`bridge.rs` の `stop_session`。**別のセッションが居れば `Err`**）。
    // ここまで来た時点で、自分の席は空いている。
    // **自分が握っている席と違うなら手放さない。** 新しい席を巻き添えにする。
    if (sessionId === undefined || seatRef.current === sessionId) {
      seatRef.current = null;
    }
  };

  // **落ちても利用者には出せない**——ここを通るのは画面が既に無いか、
  // 直後に別のエラーを出す場面。**それでも痕跡は残す。** ここが最後の防壁で、
  // 抜けられると席が残り、以降の解析が全部「Analysis already running」で
  // 断られる。しかもその失敗は「▶ を押しても何も起きない」という形でしか
  // 現れない（`docs/state-transitions/analysis.md` ※4）ので、
  // ログが無いと原因に辿り着く手掛かりが1つも無い。
  //
  // **どの口から撃ったかを書く。** 口によって、落ちた後の結末が違う。
  // `unmount` は誰も返せないまま画面が消えた回（エンジンを畳み直すしかない）。
  // 他の3つは席を握り直すので、次に畳まれたときに返し直せる——ただし
  // それまで ▶ は Rust に断られ続ける。文面が同じだと、この差を切り分けられない。
  const releaseQuietly = (at: string, sessionId?: string) => {
    void release(sessionId).catch((e) => {
      console.warn("[ANALYSIS] failed to release the engine session", { at, sessionId }, e);
    });
  };

  if (apiRef.current) return apiRef.current;

  apiRef.current = {
    isHeld: () => seatRef.current !== null,
    matches: (sessionId) => seatRef.current === null || seatRef.current === sessionId,
    hold: (sessionId) => {
      seatRef.current = sessionId;
    },
    forget: (sessionId) => {
      if (seatRef.current === sessionId) seatRef.current = null;
    },
    release,
    releaseQuietly,

    // React の state が消えても、Rust の `active_sessions` からは席が消えない。
    // 置いていくと、以降 start_infinite_analysis が「Analysis already running」で
    // 断られ、エンジンを畳み直すまで解析が二度と始まらない。
    //
    // **セッションを指さない。** 指した ID が席の主でなければ Rust は照合して断り
    // （`bridge.rs` の `stop_session`）、席は残ったままになる。握っている ID が
    // 主とずれる経路は `docs/state-transitions/analysis.md` ※12 に挙げてある。
    // 画面が居ない以上どの解析も要らないので、指さずに全部返す。
    releaseOnUnmount: () => {
      if (seatRef.current === null) return;
      releaseQuietly("unmount");
    },
  };

  return apiRef.current;
}
