import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";
import { SearchRootGate } from "./gates/SearchRootGate";
import { AnalysisBridge } from "./bridges/AnalysisBridge";
import { BoardOrientationBridge } from "./bridges/BoardOrientationBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";

export function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <FileTreeRootGate>
      <GamePersistenceGate>
        <StudyPositionsProvider>
          <EnginePresetsProvider>
            <EngineRuntimeBridge>
              <SearchRootGate>
                <AnalysisBridge>
                  <BoardOrientationBridge />
                  {children}
                </AnalysisBridge>
              </SearchRootGate>
            </EngineRuntimeBridge>
          </EnginePresetsProvider>
        </StudyPositionsProvider>
      </GamePersistenceGate>
    </FileTreeRootGate>
  );
}
