import type { EngineInfo } from "../api/rust-types";

export type EnginePhase = "idle" | "initializing" | "ready" | "error";

export type EngineRuntimeConfig = {
  enginePath: string;
  workDir: string;
  evalDir: string;
  bookDir: string | null;
  bookFile: string | null;
  options: Record<string, string>; // USI setoptions
};

export type EngineState = {
  phase: EnginePhase;
  engineInfo: EngineInfo | null;
  error: string | null;

  activeRuntime: EngineRuntimeConfig | null;
};

export type EngineAction =
  | { type: "initialize_start" }
  | {
      type: "initialize_success";
      payload: {
        engineInfo: EngineInfo;
        activeRuntime: EngineRuntimeConfig;
      };
    }
  | { type: "initialize_error"; payload: string }
  | { type: "shutdown" }
  | { type: "clear_error" };

/**
 * `isReady` が false である理由。**解析側が断りを選ぶのに使う。**
 *
 * `phase` だけでは足りない——設定が変わって起こし直している最中は `phase` が
 * `"ready"` のまま `isReady` だけ false になる。その窓で「エンジンを選んでください」と
 * 案内すると、**起こし直しを案内された利用者がその指示に従った直後**に、
 * もう一度同じ指示を受ける。
 */
export type EngineNotReadyReason =
  /**
   * 起動に要る設定が組み立てられない。**選んでいないとは限らない**——
   * 入口は `entities/engine-presets` の `runtimeConfig` が `null` を返す枝すべてで、
   * **数も条件もここに写さない**（写すと枝が増えたときにこの doc だけが古くなる）。
   * 案内を書く人はその関数を読むこと。
   */
  | "no-engine"
  /**
   * 起動中。**起こし直している最中もここ**（`phase` は `ready` のまま）。
   * **初期化が落ちた後に設定が動いた窓もここ**——起動し直す口が在る（→ engine.md の ※7）。
   */
  | "starting"
  /** 初期化が落ちている */
  | "failed";

/**
 * **待てば戻る理由。** 読み手はこれで「待つか、諦めるか」を決める
 * ——走っている解析を打ち切るかどうかがこれで変わる
 * （`docs/state-transitions/analysis.md` の ※5）。
 *
 * **この分類は engine が持つ。** 戻るかどうかを決めているのは engine の effect
 * （どの `phase` から起動し直す口が在るか）なので、読み手側に置くと、engine を
 * 変えた人の手元では何も赤くならない。判断の全体は
 * `docs/state-transitions/engine.md` の ※7。
 */
export const RECOVERABLE_NOT_READY_REASONS = ["starting"] as const;

/** 待てば戻る理由 */
export type RecoverableNotReadyReason = (typeof RECOVERABLE_NOT_READY_REASONS)[number];
/** 待っても戻らない理由。**読み手はここで諦める。** */
export type TerminalNotReadyReason = Exclude<EngineNotReadyReason, RecoverableNotReadyReason>;

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
  restart: () => Promise<boolean>;
  clearError: () => void;
};
