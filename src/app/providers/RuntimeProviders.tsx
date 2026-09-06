import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";
import { PositionSearchProvider } from "@/entities/search";
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
              <PositionSearchProvider>
                <AnalysisBridge>
                  <BoardOrientationBridge />
                  {children}
                </AnalysisBridge>
              </PositionSearchProvider>
            </EngineRuntimeBridge>
          </EnginePresetsProvider>
        </StudyPositionsProvider>
      </GamePersistenceGate>
    </FileTreeRootGate>
  );
}
