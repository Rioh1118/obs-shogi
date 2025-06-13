import { setupYaneuraOuEngine, shutdownEngine } from "@/commands/engine";
import type { EngineInfo } from "@/commands/engine/types";

export interface EngineInitializer {
  initialize(): Promise<EngineInfo>;
  shutdown(): Promise<void>;
  isInitialized(): boolean;
}

class YaneuraOuInitializer implements EngineInitializer {
  private _engineInfo: EngineInfo | null = null;
  private _isInitialized = false;

  async initialize(): Promise<EngineInfo> {
    if (this._isInitialized && this._engineInfo) {
      console.log("✅ [INITIALIZER] Engine already initialized");
      return this._engineInfo;
    }

    console.log("🚀 [INITIALIZER] Starting engine initialization...");

    try {
      const engineInfo = await setupYaneuraOuEngine();
      if (!engineInfo) {
        throw new Error("Failed to get engine info");
      }

      this._engineInfo = engineInfo;
      this._isInitialized = true;

      console.log(
        "✅ [INITIALIZER] Engine initialized successfully:",
        engineInfo.name,
      );
      return engineInfo;
    } catch (error) {
      this._isInitialized = false;
      this._engineInfo = null;
      console.error("❌ [INITIALIZER] Engine initialization failed:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this._isInitialized) {
      console.log("⚠️ [INITIALIZER] Engine not initialized, skipping shutdown");
      return;
    }

    console.log("🔌 [INITIALIZER] Shutting down engine...");

    try {
      await shutdownEngine();
      this._isInitialized = false;
      this._engineInfo = null;
      console.log("✅ [INITIALIZER] Engine shutdown completed");
    } catch (error) {
      console.error("❌ [INITIALIZER] Engine shutdown failed:", error);
      // シャットダウンエラーでも状態はリセット
      this._isInitialized = false;
      this._engineInfo = null;
      throw error;
    }
  }

  isInitialized(): boolean {
    return this._isInitialized;
  }

  getEngineInfo(): EngineInfo | null {
    return this._engineInfo;
  }
}

export const engineInitializer = new YaneuraOuInitializer();
