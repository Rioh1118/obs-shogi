import { shutdownEngine } from "@/commands/engine";
import { setupYaneuraOuEngine } from "@/commands/engine/setup";
import type { EngineInfo } from "@/commands/engine/types";

export type ResolvedEngineSetup = {
  enginePath: string;
  workDir: string;
  evalDir: string;
  bookDir: string | null;
  bookFile: string | null;
  options: Record<string, string>;
};

export interface EngineInitializer {
  initialize(resolved: ResolvedEngineSetup): Promise<EngineInfo>;
  shutdown(): Promise<void>;
}

class YaneuraOuInitializer implements EngineInitializer {
  private inFlight: Promise<EngineInfo> | null = null;

  async initialize(resolved: ResolvedEngineSetup): Promise<EngineInfo> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = setupYaneuraOuEngine({
      enginePath: resolved.enginePath,
      workDir: resolved.workDir,
      evalDir: resolved.evalDir,
      bookDir: resolved.bookDir,
      bookFile: resolved.bookFile,
      options: resolved.options,
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
