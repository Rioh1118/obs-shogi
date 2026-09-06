import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";
import { SearchRootGate } from "./gates/SearchRootGate";
import { AnalysisBridge } from "./bridges/AnalysisBridge";
import { BoardOrientationBridge } from "./bridges/BoardOrientationBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";

/**
 * `/app` の下でずっと生きている provider の入れ子と、スライス間の配線。
 *
 * **`gates/` と `bridges/` の基準:**
 * - `gates/` — 上位から取った値を、下位の provider に **prop で渡す器**。`children` を描く
 * - `bridges/` — 2つのスライスを **effect で繋ぐ**。`null` を返す
 *
 * `AnalysisBridge` と `EngineRuntimeBridge` は gate の形（値を prop で渡す器）だが
 * `bridges/` に居る。**基準に合っていない2つ**で、動かすと import が広く変わるため
 * ここでは揃えていない。→ `docs/IDEAS.md`
 */
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
