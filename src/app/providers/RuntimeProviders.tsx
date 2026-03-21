import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";
import { PositionSyncProvider } from "./bridges/position-sync";
import { PositionSearchProvider } from "@/entities/search";
import { AnalysisBridge } from "./bridges/AnalysisBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";

export function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <FileTreeRootGate>
      <GamePersistenceGate>
        <StudyPositionsProvider>
          <EnginePresetsProvider>
            <EngineRuntimeBridge>
              <PositionSyncProvider>
                <PositionSearchProvider>
                  <AnalysisBridge>{children}</AnalysisBridge>
                </PositionSearchProvider>
              </PositionSyncProvider>
            </EngineRuntimeBridge>
          </EnginePresetsProvider>
        </StudyPositionsProvider>
      </GamePersistenceGate>
    </FileTreeRootGate>
  );
}
