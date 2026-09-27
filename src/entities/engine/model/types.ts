import type { BookChoice, EngineInfo, StartWarning } from "../api/rust-types";
import type { EngineStartFailure } from "../lib/engineFailure";

export type EnginePhase = "idle" | "initializing" | "ready" | "error";

/**
 * エンジンを起こすときの設定。**USI の名前を持たない**——評価関数と定跡はパスで持ち、
 * どの名前で送るかは Rust が起動のたびの申告から決める（`binding.rs`）
 */
export type EngineRuntimeConfig = {
  enginePath: string;
  /** 評価関数（絶対パス）。選んでいなければ `null`（指定できないエンジンもある） */
  evalPath: string | null;
  /** 定跡。選んでいなければ `null`。`useInAnalysis` が偽でも、切ったことを Rust が送る */
  book: BookChoice | null;
  /** 利用者の値（プリセットの `options`） */
  values: Record<string, string>;
};

export type EngineState = {
  phase: EnginePhase;
  engineInfo: EngineInfo | null;
  /** 起動の失敗。`phase === "error"` のときだけ非 null。画面の文言は `kind` から組む */
  error: EngineStartFailure | null;

  activeRuntime: EngineRuntimeConfig | null;
  /** 直近の起動で送らなかった・変えて送った設定。起動はできている */
  startWarnings: StartWarning[];
};

export type EngineAction =
  | { type: "initialize_start" }
  | {
      type: "initialize_success";
      payload: {
        engineInfo: EngineInfo;
        activeRuntime: EngineRuntimeConfig;
        warnings: StartWarning[];
      };
    }
  | { type: "initialize_error"; payload: EngineStartFailure }
  | { type: "shutdown" }
  | { type: "clear_error" };

/**
 * `isReady` が false である理由。**解析側が断りを選ぶのに使う。**
 *
 * **`phase` では割れない。** 起こし直しは `ready → idle → initializing` を通り、
 * どの段でも `isReady` は false。`phase` で並べると `idle` を書き落として
 * 「エンジンを選んでください」に落ち、**起こし直しを案内された利用者がその指示に
 * 従った直後**に、もう一度同じ指示を受ける。判定は「選んでいるか」で割る
 * （導出は `entities/engine/model/provider.tsx`）。
 */
export type EngineNotReadyReason =
  /** まだ選んでいない（または設定が読めていない） */
  | "no-engine"
  /** 起動中。**起こし直している最中もここ**（`ready → idle → initializing` の全部） */
  | "starting"
  /** 初期化が落ちている */
  | "failed";

/**
 * **「使えないなら理由が在る」を型で持つ。** 2つの欄を独立に持つと、呼び手は
 * `notReadyReason ?? "既定値"` を書くことになり、その既定値が理由を取り違える
 * （どれを選んでも、3つのうち2つでは嘘になる）。
 */
export type EngineReadiness =
  | { isReady: true; notReadyReason: null }
  | { isReady: false; notReadyReason: EngineNotReadyReason };

export type EngineContextType = EngineReadiness & {
  state: EngineState;

  initialize: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  /**
   * 進行中の起動をやめる。エンジンを落とし、失敗（種類 `cancelled`）として止まる——
   * `idle` に戻すと、設定が選ばれたままなので同じ設定で起動し直してしまう
   */
  cancelStart: () => void;
  restart: () => Promise<boolean>;
  clearError: () => void;
};
