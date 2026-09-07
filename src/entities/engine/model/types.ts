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
  /** まだ選んでいない（または設定が読めていない） */
  | "no-engine"
  /** 起動中。**起こし直している最中もここ**（`phase` は `ready` のまま） */
  | "starting"
  /** 初期化が落ちている */
  | "failed";

export type EngineContextType = {
  state: EngineState;
  // derived
  isReady: boolean;
  /** `isReady` が true のときは null */
  notReadyReason: EngineNotReadyReason | null;

  initialize: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  restart: () => Promise<boolean>;
  clearError: () => void;
};
