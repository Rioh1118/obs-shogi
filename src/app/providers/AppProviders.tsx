import type { ReactNode } from "react";
import { AppConfigProvider } from "@/entities/app-config";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppConfigProvider>
      <FileTreeRootGate>
        <GamePersistenceGate>
          <EnginePresetsProvider>
            <EngineRuntimeBridge>{children}</EngineRuntimeBridge>
          </EnginePresetsProvider>
        </GamePersistenceGate>
      </FileTreeRootGate>
    </AppConfigProvider>
  );
}
