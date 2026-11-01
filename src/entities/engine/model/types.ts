import type { BookChoice, EngineInfo, StartWarning, UnresponsiveReason } from "../api/rust-types";
import type { EngineStartFailure } from "../lib/engineFailure";

/**
 * エンジンの段。`exited` は起動済みのプロセスが自分で終わった状態、`unresponsive` は指示が
 * 通らなくなった状態。どちらもアプリは自分では起動し直さない
 * （`docs/state-transitions/engine-standardization.md` の V6 V7）
 */
export type EnginePhase = "idle" | "initializing" | "ready" | "error" | "exited" | "unresponsive";

/**
 * エンジンを起動するときの設定。USI の名前を持たない。評価関数と定跡はパスで持ち、
 * どの名前で送るかは Rust が起動のたびの申告から決める（`binding.rs`）
 */
export type EngineRuntimeConfig = {
  enginePath: string;
  /** 評価関数（絶対パス）。選んでいなければ `null`（指定できないエンジンもある） */
  evalPath: string | null;
  /** 定跡。選んでいなければ `null`。`useInAnalysis` が偽なら、切ったことを Rust が送る */
  book: BookChoice | null;
  /** 利用者の値（プリセットの `options`） */
  values: Record<string, string>;
};

export type EngineState = {
  phase: EnginePhase;
  engineInfo: EngineInfo | null;
  /** 起動の失敗。`phase === "error"` のときだけ非 null。画面の文言は `kind` から組む */
  error: EngineStartFailure | null;
  /** 指示が通らない理由。`phase === "unresponsive"` のときだけ非 null */
  unresponsiveReason: UnresponsiveReason | null;
  /** エンジンが最後に出した行。`exited` と `unresponsive` のときだけ。起動の失敗は `error` が持つ */
  lastOutput: string | null;

  activeRuntime: EngineRuntimeConfig | null;
  /** 直近の起動で送らなかった、または変えて送った設定。起動はできている */
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
  | { type: "engine_exited"; payload: string | null }
  | {
      type: "engine_unresponsive";
      payload: { reason: UnresponsiveReason; lastOutput: string | null };
    }
  | { type: "engine_answered" }
  | { type: "shutdown" };

/**
 * `isReady` が false である理由。解析側が断りを選ぶのに使う。導出は `notReadyReasonOf`
 */
export type EngineNotReadyReason =
  /** まだ選んでいない（または設定が読めていない） */
  | "no-engine"
  /** 起動中。起動し直している最中もここ（`ready → idle → initializing` の全部） */
  | "starting"
  /** 起動できない。プロセスが終わったとき、指示が通らないとき、プリセットが未完成のときもここ */
  | "failed"
  /** 利用者が起動を中止した */
  | "cancelled";

/**
 * エンジンを使えるか。使えないなら必ず理由が在る。2つの欄を独立に持つと、呼び手が
 * `notReadyReason ?? "既定値"` を書くことになり、その既定値が理由を取り違える
 */
export type EngineReadiness =
  | { isReady: true; notReadyReason: null }
  | { isReady: false; notReadyReason: EngineNotReadyReason };

export type EngineContextType = EngineReadiness & {
  state: EngineState;

  initialize: () => Promise<void>;
  /**
   * 進行中の起動を中止する。エンジンを落とし、失敗（種類 `cancelled`）として止まる。
   * `idle` に戻すと、設定が選ばれたままなので同じ設定で起動し直してしまう
   */
  cancelStart: () => void;
  /** `起動中…` が `SLOW_START_MS` を越えた。帯とボタンが同じ値を読む */
  slowStart: boolean;
  /** プリセットは選んだが、エンジンが未設定で起動を試みられない */
  presetIncomplete: boolean;
  /**
   * エンジンへ指示が届かなかったことを知らせ、`応答なし` にする。
   * Rust の通知を待たない。invoke そのものが落ちると Rust は何も知らない
   */
  reportUnreachable: () => void;
};
