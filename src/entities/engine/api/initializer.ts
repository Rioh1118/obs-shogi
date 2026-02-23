import { setupYaneuraOuEngine } from "../lib/setup";
import type { EngineRuntimeConfig } from "../model/types";
import type { EngineInfo } from "./rust-types";
import { shutdownEngine } from "./tauri";

export interface EngineInitializer {
  initialize(runtime: EngineRuntimeConfig): Promise<EngineInfo>;
  shutdown(): Promise<void>;
}

class YaneuraOuInitializer implements EngineInitializer {
  private inFlight: Promise<EngineInfo> | null = null;

  async initialize(runtime: EngineRuntimeConfig): Promise<EngineInfo> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = setupYaneuraOuEngine({
      enginePath: runtime.enginePath,
      workDir: runtime.workDir,
      evalDir: runtime.evalDir,
      bookDir: runtime.bookDir,
      bookFile: runtime.bookFile,
      options: runtime.options,
    }).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    const p = this.inFlight;
    this.inFlight = null;

    if (p) {
      try {
        await p;
      } catch {
        /* ignore */
      }
    }
    await shutdownEngine();
  }
}

export const engineInitializer = new YaneuraOuInitializer();
