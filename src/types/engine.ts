export type EnginePhase = "idle" | "initializing" | "ready" | "error";

export type EngineRuntimeConfig = {
  enginePath: string;
  workDir: string;
  evalDir: string;
  bookDir: string | null;
  bookFile: string | null;
  options: Record<string, string>; // USI setoptions
};
