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

export type EngineContextType = {
  state: EngineState;
  // derived
  isReady: boolean;

  initialize: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  restart: () => Promise<boolean>;
  clearError: () => void;
};
