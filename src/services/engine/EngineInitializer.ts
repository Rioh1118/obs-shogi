import { shutdownEngine } from "@/commands/engine";
import { setupYaneuraOuEngine } from "@/commands/engine/setup";
import type { EngineInfo } from "@/commands/engine/types";

export type ResolvedEngineSetup = {
  enginePath: string;
  workDir: string;
  evalDir: string;
  bookDir: string;
  bookFile: string;
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

    this.inFlight = (async () => {
      const info = await setupYaneuraOuEngine({
        enginePath: resolved.enginePath,
        workDir: resolved.workDir,
        evalDir: resolved.evalDir,
        bookDir: resolved.bookDir,
        bookFile: resolved.bookFile,
        options: resolved.options,
      });
      return info;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async shutdown(): Promise<void> {
    this.inFlight = null;
    await shutdownEngine();
  }
}

export const engineInitializer = new YaneuraOuInitializer();
